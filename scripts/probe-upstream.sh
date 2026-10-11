#!/usr/bin/env bash
# probe-upstream.sh — determine exactly which wire formats the real provider
# supports, so config/litellm.yaml can be written correctly.
#
#   usage: UPSTREAM_BASE_URL=... UPSTREAM_API_KEY=... ./scripts/probe-upstream.sh
#
# Exit codes are irrelevant; read the report.

set -uo pipefail

BASE="${UPSTREAM_BASE_URL:?set UPSTREAM_BASE_URL}"
KEY="${UPSTREAM_API_KEY:?set UPSTREAM_API_KEY}"
BASE="${BASE%/}"

# Strip a trailing /v1 so both styles normalise to the same origin+path prefix.
ROOT="${BASE%/v1}"
PROMPT='Reply with the single word: ok'

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }
hdr() { hr; printf '  %s\n' "$1"; hr; }

hdr "0. TARGET"
printf '  base    : %s\n' "$BASE"
printf '  origin  : %s\n' "$ROOT"
printf '  key     : %s…%s (%d chars)\n' "${KEY:0:8}" "${KEY: -4}" "${#KEY}"

# ─────────────────────────────────────────────────────────────────────
hdr "1. OPENAI-COMPATIBLE  POST /chat/completions"

OAI_URL="$BASE/chat/completions"
[ "$BASE" = "$ROOT" ] && OAI_URL="$ROOT/v1/chat/completions"

OAI_BODY=$(curl -sS -m 45 -w '\n__HTTP__%{http_code}' -X POST "$OAI_URL" \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$( [ -n "${UPSTREAM_PROBE_MODEL:-}" ] && echo "$UPSTREAM_PROBE_MODEL" || echo "claude-sonnet-5" )\",
       \"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}],
       \"max_tokens\":16}" 2>&1)

OAI_CODE=$(printf '%s' "$OAI_BODY" | sed -n 's/.*__HTTP__//p')
OAI_JSON=$(printf '%s' "$OAI_BODY" | sed 's/__HTTP__.*//')

echo "  url   : $OAI_URL"
echo "  http  : $OAI_CODE"
if [ "$OAI_CODE" = "200" ]; then
  echo "  ✅ OPENAI-COMPATIBLE"
  printf '  usage : %s\n' \
    "$(printf '%s' "$OAI_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get("usage",{})))' 2>/dev/null || echo 'n/a')"
else
  echo "  ❌ not available"
  printf '  body  : %.200s\n' "$OAI_JSON"
fi

# ─────────────────────────────────────────────────────────────────────
hdr "2. ANTHROPIC-NATIVE  POST /v1/messages  (x-api-key)"

ANT_URL="$ROOT/v1/messages"
ANT_BODY=$(curl -sS -m 45 -w '\n__HTTP__%{http_code}' -X POST "$ANT_URL" \
  -H "x-api-key: $KEY" \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$( [ -n "${UPSTREAM_PROBE_MODEL:-}" ] && echo "$UPSTREAM_PROBE_MODEL" || echo "claude-sonnet-5" )\",
       \"max_tokens\":16,
       \"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}" 2>&1)

ANT_CODE=$(printf '%s' "$ANT_BODY" | sed -n 's/.*__HTTP__//p')
ANT_JSON=$(printf '%s' "$ANT_BODY" | sed 's/__HTTP__.*//')

echo "  url   : $ANT_URL"
echo "  http  : $ANT_CODE"
if [ "$ANT_CODE" = "200" ]; then
  echo "  ✅ ANTHROPIC-NATIVE (x-api-key)"
  printf '  usage : %s\n' \
    "$(printf '%s' "$ANT_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);u=d.get("usage",{});print(json.dumps({k:u.get(k) for k in ("input_tokens","output_tokens","cache_creation_input_tokens","cache_read_input_tokens","cache_creation")}))' 2>/dev/null || echo 'n/a')"
else
  echo "  ❌ not available via x-api-key"
  printf '  body  : %.200s\n' "$ANT_JSON"
fi

# ─────────────────────────────────────────────────────────────────────
hdr "3. ANTHROPIC-NATIVE  POST /v1/messages  (Authorization: Bearer)"

ANT2_BODY=$(curl -sS -m 45 -w '\n__HTTP__%{http_code}' -X POST "$ANT_URL" \
  -H "Authorization: Bearer $KEY" \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$( [ -n "${UPSTREAM_PROBE_MODEL:-}" ] && echo "$UPSTREAM_PROBE_MODEL" || echo "claude-sonnet-5" )\",
       \"max_tokens\":16,
       \"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}" 2>&1)

ANT2_CODE=$(printf '%s' "$ANT2_BODY" | sed -n 's/.*__HTTP__//p')
[ "$ANT2_CODE" = "200" ] \
  && echo "  ✅ accepts Authorization: Bearer" \
  || echo "  ❌ bearer rejected ($ANT2_CODE) — use x-api-key upstream"

# ─────────────────────────────────────────────────────────────────────
hdr "4. MODEL LISTING  GET /v1/models"

MODELS=$(curl -sS -m 30 "$BASE/models" -H "Authorization: Bearer $KEY" 2>&1)
printf '%s' "$MODELS" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    ids = [m.get("id") for m in d.get("data", []) if isinstance(m, dict)]
    print(f"  ✅ {len(ids)} model(s)")
    for i in sorted(ids)[:40]:
        print(f"     - {i}")
except Exception:
    print("  (no machine-readable model list)")
' 2>/dev/null || echo "  (not queryable)"

# ─────────────────────────────────────────────────────────────────────
hdr "5. PROMPT CACHING  (cost accounting depends on this)"

CACHE_BODY=$(curl -sS -m 45 -X POST "$ROOT/v1/messages/count_tokens" \
  -H "x-api-key: $KEY" \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-5","messages":[{"role":"user","content":"hello"}]}')
if printf '%s' "$CACHE_BODY" | grep -q '"input_tokens"'; then
  echo "  ✅ /v1/messages/count_tokens works — pre-flight estimation available"
else
  echo "  ⚠️  count_tokens unavailable — rely on post-hoc usage only"
fi

# ─────────────────────────────────────────────────────────────────────
hdr "VERDICT — now write config/litellm.yaml"

OPENAI_OK=0;  [ "$OAI_CODE" = "200" ] && OPENAI_OK=1
ANT_OK=0;    [ "$ANT_CODE" = "200" ] && ANT_OK=1

if [ "$OPENAI_OK" = "1" ] && [ "$ANT_OK" = "1" ]; then
  cat <<'EOF'
  ✅ BOTH FORMATS AVAILABLE — upstream is dual-compatible.

  Use the "BOTH-NATIVE" model_list block from config/litellm.yaml.
  /v1/chat/completions  → untranslated
  /v1/messages          → untranslated (requires the supported_endpoints opt-in
                          on the openai/ deployment; see DESIGN.md §4.3)

  No translation loss. cache_control survives on both paths.
EOF
elif [ "$OPENAI_OK" = "1" ]; then
  cat <<'EOF'
  ⚠️  OPENAI-COMPATIBLE ONLY.

  Use the "OPENAI-ONLY" block from config/litellm.yaml.
  /v1/chat/completions  → native
  /v1/messages          → TRANSLATED by LiteLLM, and translation is LOSSY:
                          · cache_control blocks are dropped
                          · thinking maps to the provider's own reasoning param
                          · other Anthropic-only fields approximated or lost

  Consequence: if your workload depends on prompt caching, /v1/messages
  clients will silently lose cache reads and cost ~10x more per repeated
  prefix. Verify with DESIGN.md acceptance test A-6.
EOF
elif [ "$ANT_OK" = "1" ]; then
  cat <<'EOF'
  ⚠️  ANTHROPIC-NATIVE ONLY.

  Use the "ANTHROPIC-ONLY" block. /v1/chat/completions will be TRANSLATED
  from OpenAI format; system messages and tool-call shapes are approximated.
EOF
else
  cat <<'EOF'
  ❌ NEITHER FORMAT WORKED.

  Check: key validity, base URL correctness, credits/balance, and whether
  this key is a Console API key rather than a claude.ai subscription token.
EOF
fi

hr