#!/usr/bin/env bash
# smoke.sh — acceptance suite. DESIGN.md §9.
#   usage: ./scripts/smoke.sh [tenant-key]
#
# Tests A-1..A-16. A-4, A-5, A-6, A-8, A-15 catch the failures that
# actually happen; the rest are hygiene.
set -uo pipefail

API="${API_DOMAIN:-api.yourdomain.com}"
BASE="https://$API"
LOCAL="http://127.0.0.1:4000"
KEY="${1:-${TENANT_KEY:-}}"
MODEL="${SMOKE_MODEL:-fast}"
MODEL_RICH="${SMOKE_MODEL_RICH:-smart}"

if [ -z "$KEY" ]; then
  echo "usage: $0 <tenant-key>   (or set TENANT_KEY)" >&2
  exit 2
fi

PASS=0; FAIL=0; SKIP=0
hr()  { printf '%s\n' "────────────────────────────────────────────────────────"; }
ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  ❌ %s\n' "$1"; printf '     %s\n' "$2"; FAIL=$((FAIL+1)); }
skip() { printf '  ⏭  %s\n' "$1"; SKIP=$((SKIP+1)); }

code() { curl -sS -m 90 -o /dev/null -w '%{http_code}' "$@"; }

# ════════════════════════════════════════════════════════════════
hr; printf '  A-1  Authentication — bad key, both auth styles\n'; hr
c1=$(code "$BASE/v1/chat/completions" -H "Authorization: Bearer sk-invalid" \
      -H 'Content-Type: application/json' -d "{\"model\":\"$MODEL\",\"messages\":[]}")
c2=$(code "$BASE/v1/messages" -H "x-api-key: sk-invalid" \
      -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":8,\"messages\":[]}")
[ "$c1" = "401" ] && [ "$c2" = "401" ] \
  && ok "A-1  both rejected ($c1/$c2)" \
  || bad "A-1  bad key not rejected on both" "chat=$c1 messages=$c2"

# ════════════════════════════════════════════════════════════════
hr; printf '  A-2  OpenAI wire format\n'; hr
R2=$(curl -sS -m 90 "$BASE/v1/chat/completions" \
      -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
printf '%s' "$R2" | grep -q '"choices"' \
  && ok "A-2  OpenAI format served" \
  || bad "A-2  OpenAI format failed" "$(printf '%s' "$R2" | head -c 200)"

# ════════════════════════════════════════════════════════════════
hr; printf '  A-3  Anthropic wire format\n'; hr
R3=$(curl -sS -m 90 "$BASE/v1/messages" \
      -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
printf '%s' "$R3" | grep -q '"content"' \
  && ok "A-3  Anthropic format served" \
  || bad "A-3  Anthropic format failed" "$(printf '%s' "$R3" | head -c 200)"

# ════════════════════════════════════════════════════════════════
hr; printf '  A-4  Dual-format pairing (same model_name on both paths)\n'; hr
M2=$(printf '%s' "$R2" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("model",""))' 2>/dev/null)
M3=$(printf '%s' "$R3" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("model",""))' 2>/dev/null)
if [ -n "$M2" ] && [ -n "$M3" ]; then
  ok "A-4  resolved  openai=$M2  anthropic=$M3"
  [ "$M2" != "$M3" ] && printf '     note: different resolved models — confirm this is intended\n'
else
  bad "A-4  could not resolve model on both paths" "openai='$M2' anthropic='$M3'"
fi

# ════════════════════════════════════════════════════════════════
hr; printf '  A-5  Auth header matrix on /v1/messages\n'; hr
a=$(code "$BASE/v1/messages" -H "Authorization: Bearer $KEY" \
      -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
b=$(code "$BASE/v1/messages" -H "x-api-key: $KEY" \
      -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
[ "$a" = "200" ] && [ "$b" = "200" ] \
  && ok "A-5  Bearer=$a  x-api-key=$b" \
  || bad "A-5  auth header styles disagree" "bearer=$a x-api-key=$b"

# ════════════════════════════════════════════════════════════════
hr; printf '  A-6  cache_control survives on the Anthropic path\n'; hr
LONG=$(python3 -c 'print("The quick brown fox jumps over the lazy dog. " * 400)')
R6=$(curl -sS -m 120 "$BASE/v1/messages" \
      -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":8,
           \"system\":[{\"type\":\"text\",\"text\":\"$LONG\",
                       \"cache_control\":{\"type\":\"ephemeral\"}}],
           \"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
CREAD=$(printf '%s' "$R6" | python3 -c '
import sys,json
try: print(json.load(sys.stdin).get("usage",{}).get("cache_creation_input_tokens",0))
except Exception: print(0)' 2>/dev/null)
CREAD2=$(curl -sS -m 120 "$BASE/v1/messages" \
      -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"max_tokens\":8,
           \"system\":[{\"type\":\"text\",\"text\":\"$LONG\",
                       \"cache_control\":{\"type\":\"ephemeral\"}}],
           \"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
READ2=$(printf '%s' "$CREAD2" | python3 -c '
import sys,json
try: print(json.load(sys.stdin).get("usage",{}).get("cache_read_input_tokens",0))
except Exception: print(0)' 2>/dev/null)

if [ "${CREAD:-0}" -gt 0 ] 2>/dev/null; then
  ok "A-6  cache_creation=$CREAD  cache_read=$READ2"
  [ "${READ2:-0}" -gt 0 ] && ok "A-6b cache hit on repeat — caching works end-to-end" \
    || bad "A-6b no cache read on identical repeat" "cache_control may be stripped upstream"
else
  bad "A-6  cache_control not honoured" \
      "cache_creation=$CREAD. If your upstream is OpenAI-only, LiteLLM is TRANSLATING /v1/messages and DROPPING cache_control — see DESIGN.md §4.2/§4.6."
fi

# ════════════════════════════════════════════════════════════════
hr; printf '  A-7  Model allowlist\n'; hr
c=$(code "$BASE/v1/chat/completions" -H "Authorization: Bearer $KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"__not_allowed__\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
case "$c" in 401|403|400)
  ok "A-7  disallowed model denied ($c)" ;;
  *) bad "A-7  disallowed model was not denied" "got $c" ;;
esac

# ════════════════════════════════════════════════════════════════
hr; printf '  A-8  Budget hard stop  ⚠️  CRITICAL\n'; hr
if [ -n "${LITELLM_MASTER_KEY:-}" ]; then
  CANARY=$(curl -sS -m 30 -X POST "$LOCAL/key/generate" \
    -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
    -d "{\"key_name\":\"canary-$$\",\"models\":[\"$MODEL\"],
         \"max_budget\":0.000001,\"budget_duration\":\"30d\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("key",""))' 2>/dev/null)
  if [ -n "$CANARY" ]; then
    c=$(code "$BASE/v1/chat/completions" -H "Authorization: Bearer $CANARY" \
          -H 'Content-Type: application/json' \
          -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
    if [ "$c" = "429" ] || [ "$c" = "402" ]; then
      ok "A-8  over-budget request rejected ($c)"
    else
      bad "A-8  BUDGET NOT ENFORCED — got $c" \
          "Postgres is not wired to the proxy. EVERY budget in this system is currently a no-op. Fix before issuing any real keys."
    fi
    curl -sS -m 20 -X POST "$LOCAL/key/delete" \
      -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
      -d "{\"keys\":[\"$CANARY\"]}" >/dev/null 2>&1
  else
    skip "A-8  LITELLM_MASTER_KEY not set — cannot mint canary"
  fi
else
  skip "A-8  LITELLM_MASTER_KEY not set — cannot mint canary"
fi

# ════════════════════════════════════════════════════════════════
hr; printf '  A-9  Streaming is not buffered\n'; hr
python3 - "$BASE" "$KEY" "$MODEL" <<'PY'
import json, os, sys, time, urllib.request
base, key, model = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"{base}/v1/chat/completions",
    data=json.dumps({"model": model, "stream": True,
        "messages": [{"role": "user", "content": "count slowly from 1 to 20"}]}).encode(),
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
t0, first, n = time.time(), None, 0
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        for line in r:
            if line.startswith(b"data:"):
                if first is None:
                    first = time.time() - t0
                n += 1
except Exception as e:
    print(f"  ❌ A-9  stream error: {e}"); sys.exit(0)
if first is None:
    print("  ❌ A-9  no chunks received")
elif first > 10:
    print(f"  ❌ A-9  TTFT {first:.1f}s — response is being buffered")
elif n < 3:
    print(f"  ❌ A-9  only {n} chunk(s) — not a real stream")
else:
    print(f"  ✅ A-9  TTFT={first:.2f}s  chunks={n}")
PY

# ════════════════════════════════════════════════════════════════
hr; printf '  A-11  Forged X-Forwarded-For is ignored\n'; hr
code "$BASE/v1/chat/completions" \
  -H "X-Forwarded-For: 203.0.113.99" -H "CF-Connecting-IP: 203.0.113.99" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" >/dev/null
echo "  ℹ️  Now check the recorded client IP is the real peer, not 203.0.113.99:"
echo "     make report  →  inspect recent entries"
echo "     If it shows 203.0.113.99, DESIGN.md §6.1 is violated and all IP limits are void."

# ════════════════════════════════════════════════════════════════
hr; printf '  A-12  Forged api_base in body is ignored (SSRF)\n'; hr
c=$(code "$BASE/v1/chat/completions" -H "Authorization: Bearer $KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"$MODEL\",\"api_base\":\"http://169.254.169.254/\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
case "$c" in
  200|400) ok "A-12  injected api_base rejected or ignored ($c)" ;;
  *) bad "A-12  unexpected status $c on SSRF attempt" "Investigate immediately" ;;
esac

# ════════════════════════════════════════════════════════════════
hr; printf '  A-14  Management routes not served on the public host\n'; hr
c=$(code "$BASE/key/generate" -X POST -H "Content-Type: application/json" -d '{}')
case "$c" in
  404|405) ok "A-14  /key/generate absent on public host ($c)" ;;
  *)      bad "A-14  management route reachable on public host" "got $c — check allowed_routes" ;;
esac

# ════════════════════════════════════════════════════════════════
hr; printf '  A-15  Body-supplied "user" cannot redirect spend\n'; hr
BEFORE=$(curl -sS -m 20 "$LOCAL/key/info" -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-x}" \
         | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("spend",0))' 2>/dev/null || echo "")
code "$BASE/v1/chat/completions" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"user\":\"someone-else\",
       \"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" >/dev/null
AFTER=$(curl -sS -m 20 "$LOCAL/key/info" -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-x}" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("spend",0))' 2>/dev/null || echo "")
if [ -n "$BEFORE" ] && [ -n "$AFTER" ]; then
  python3 -c "import sys;sys.exit(0 if float('$AFTER')>float('$BEFORE') else 1)" \
    && ok "A-15  spend still attributed to this key ($BEFORE → $AFTER)" \
    || bad "A-15  spend did not move" "key spend $BEFORE → $AFTER"
else
  skip "A-15  LITELLM_MASTER_KEY not set — cannot verify attribution"
fi

# ════════════════════════════════════════════════════════════════
hr; printf '  RESULT\n'; hr
printf '  passed %d   failed %d   skipped %d\n\n' "$PASS" "$FAIL" "$SKIP"
echo "  Manual-only checks (need your eyes or extra setup):"
echo "    A-10  cost reconciliation vs prices/models.yaml   → make reconcile"
echo "    A-13  admin host rejects non-allowlisted IP        → curl from another network"
echo "    A-16  key revocation takes effect immediately"
echo "    A-17  backup restore reproduces keys and budgets"
[ "$FAIL" -gt 0 ] && exit 1
exit 0