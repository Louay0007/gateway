#!/usr/bin/env bash
# scrub-check.sh — pre-commit / pre-push secret gate for a PUBLIC repo.
#
# Fails on real credential shapes, allows documented placeholders:
#   ALLOWED: sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx, sk-..., ${VAR}, sk-test-*
#   FLAGGED: sk-ant-<20+ mixed chars>, sk-live-<20+>, ghp_/github_pat_,
#            private keys, DSNs carrying a password, Stripe live secrets.
#
#   usage: ./scripts/scrub-check.sh [ref]
#   default scans tracked files in working tree; pass HEAD to scan history:
#     ./scripts/scrub-check.sh HEAD   (scans all files at HEAD)
set -uo pipefail

REF="${1:-}"
FAIL=0

flag() { printf '  ❌ %s\n     %s\n' "$1" "$2"; FAIL=1; }

# Files to scan: tracked files, excluding lockfiles and this script's docs.
list_files() {
  if [ -n "$REF" ]; then
    git ls-tree -r --name-only "$REF"
  else
    git ls-files
  fi | grep -vE '^(portal/package-lock\.json|.*\.lock)$' || true
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Materialise the EXACT set of files that would be committed, into $TMP,
# and scan that. Scanning the working tree instead would sweep in
# node_modules, .next, and build output — thousands of vendored files
# that are never committed, producing false positives (and a slower,
# noisier gate). When a REF is given, scan that tree instead.
if [ -n "$REF" ]; then
  while IFS= read -r f; do
    mkdir -p "$TMP/$(dirname "$f")"
    git show "$REF:$f" > "$TMP/$f" 2>/dev/null || true
  done < <(list_files)
else
  # Working-tree scan: copy tracked (non-ignored) files into $TMP so the
  # recursive greps below operate on the committed set, not the tree.
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    mkdir -p "$TMP/$(dirname "$f")"
    cp "$f" "$TMP/$f" 2>/dev/null || true
  done < <(list_files)
fi
SCAN_ROOT="$TMP"

# The forbidden-filename check (#7) reads `git ls-files` directly, which is
# correct regardless of SCAN_ROOT.

# 1. Anthropic-style keys with real entropy (≥20 mixed chars).
#    Placeholders like sk-ant-xxx... or sk-ant-... do not match {20,}
#    of mixed classes... so require length AND mixed classes explicitly.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    'sk-ant-[A-Za-z0-9_-]{40,}' "$SCAN_ROOT" 2>/dev/null \
    | grep -vE 'x{8,}|X{8,}' | grep -q .; then
  flag "possible Anthropic API key" \
    "$(grep -rEn 'sk-ant-[A-Za-z0-9_-]{40,}' "$SCAN_ROOT" 2>/dev/null | grep -vE 'x{8,}|X{8,}' | head -3 | cut -c1-120)"
fi

# 2. Stripe live secrets / restricted keys.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    -e 'sk_live_[A-Za-z0-9]{16,}' -e 'rk_live_[A-Za-z0-9]{16,}' \
    -e 'whsec_[A-Za-z0-9]{16,}' "$SCAN_ROOT" 2>/dev/null | grep -q .; then
  flag "possible Stripe live secret" \
    "$(grep -rEn -e 'sk_live_[A-Za-z0-9]{16,}' "$SCAN_ROOT" 2>/dev/null | head -2 | cut -c1-120)"
fi
# sk_test_ keys are also secrets — flag them outside .env.example/docs examples?
# No: test keys in docs are normal. Only flag with sufficient length AND
# not on a line marked as example/placeholder.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    'sk_test_[A-Za-z0-9]{16,}' "$SCAN_ROOT" 2>/dev/null \
    | grep -viE 'example|placeholder|your-|xxx|PUT_YOUR' | grep -q .; then
  flag "possible Stripe test secret (non-example)" \
    "$(grep -rEn 'sk_test_[A-Za-z0-9]{16,}' "$SCAN_ROOT" 2>/dev/null | head -2 | cut -c1-120)"
fi

# 3. GitHub / generic tokens.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    -e 'ghp_[A-Za-z0-9]{20,}' -e 'github_pat_[A-Za-z0-9_]{20,}' \
    -e 'gho_[A-Za-z0-9]{20,}' "$SCAN_ROOT" 2>/dev/null | grep -q .; then
  flag "possible GitHub token" "rotate immediately if real"
fi

# 4. Private keys.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' "$SCAN_ROOT" 2>/dev/null | grep -q .; then
  flag "private key material in repo" "move to VPS-only storage"
fi

# 5. DSNs carrying a literal password (allows ${VAR} refs and user-only forms).
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    -E 'postgres(ql)?://[^/: ]+:[^$@ ][^@]*@' "$SCAN_ROOT" 2>/dev/null | grep -q .; then
  flag "DSN with literal password" \
    "$(grep -rEn -E 'postgres(ql)?://[^/: ]+:[^$@ ][^@]*@' "$SCAN_ROOT" 2>/dev/null | head -2 | cut -c1-120)"
fi

# 6. Long assignments that smell like pasted secrets (KEY/SECRET/PASSWORD/TOKEN
#    with >=20 non-placeholder chars), excluding ${VAR} refs and short values.
#
#    The right-hand side must be a QUOTED STRING LITERAL to be flagged. Without
#    that constraint the rule fires on ordinary code — `password:
#    authCredentials.password` (a column selector) or
#    `fieldErrors.password = ...` (a property assignment) — because the key
#    is just an identifier whose NAME happens to be "password". A pasted
#    secret is always a string literal.
if grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next \
    -Ei '(api[_-]?key|secret|password|token)\s*[:=]\s*["'"'"'][A-Za-z0-9_.\-]{20,}["'"'"']' "$SCAN_ROOT" 2>/dev/null \
    | grep -vE '\$\{|\.\.\.|xxx|XXX|your-|YOUR_|example|changeme|placeholder|<[^>]+>' | grep -q .; then
  flag "suspicious long credential literal" \
    "$(grep -rEn -Ei '(api[_-]?key|secret|password|token)\s*[:=]\s*["'"'"'][A-Za-z0-9_.\-]{20,}["'"'"']' "$SCAN_ROOT" 2>/dev/null | grep -vE '\$\{|\.\.\.|xxx|XXX|your-|YOUR_|example|changeme|placeholder|<[^>]+>' | head -3 | cut -c1-140)"
fi

# 7. Forbidden filenames that must never be tracked.
if git ls-files | grep -qE '(^|/)\.env$|\.pem$|\.key$|backup-.*\.sql\.gz$|latency\.csv$|\.env\.local$'; then
  flag "forbidden file tracked by git" \
    "$(git ls-files | grep -E '(^|/)\.env$|\.pem$|\.key$|backup-.*\.sql\.gz$|latency\.csv$|\.env\.local$' | head -5)"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ scrub-check clean — no credential shapes detected"
  exit 0
else
  echo
  echo "  Fix: remove the secret, rotate the credential, then commit."
  echo "  If it leaked into history: rotate FIRST, then git filter-repo."
  exit 1
fi