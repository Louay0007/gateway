#!/usr/bin/env bash
# Probe every model in a provider's catalogue for AGENTIC CODING capability.
#
# A model is only useful behind this gateway if it can actually drive a tool
# loop. Chat quality alone is not enough — a coding agent lives or dies on
# tool_calls and on the second turn (tool result -> answer). This script
# tests exactly that, plus the two wire formats the gateway serves.
#
# Prints one TSV row per model. Exits non-zero only on usage error.
set -uo pipefail

BASE="${BASE:-https://api.howtofix.id/v1}"
KEY="${KEY:?set KEY}"
OUT="${OUT:-/tmp/model-probe.tsv}"
: > "$OUT"

models=$(curl -sS -m 40 "$BASE/models" -H "Authorization: Bearer $KEY" \
  | python3 -c "import sys,json;print('\n'.join(m['id'] for m in json.load(sys.stdin)['data']))")

printf 'model\thttp\ttool_calls\targs_valid\tloop_reply\tsse_frames\tmessages\tverdict\n' >> "$OUT"

for m in $models; do
  # 1. tool calling — does it emit a well-formed call at all?
  curl -sS -m 90 -o /tmp/p_tc.json -w '%{http_code}' -X POST "$BASE/chat/completions" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $KEY" \
    -d "{\"model\":\"$m\",\"max_tokens\":2048,\"messages\":[{\"role\":\"user\",\"content\":\"What is the weather in Paris? Use the get_weather tool.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get weather for a city\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}]}" \
    > /tmp/p_code.txt 2>/dev/null
  code=$(cat /tmp/p_code.txt)

  tc=$(python3 - <<'PY' 2>/dev/null || echo "-"
import json
d = json.load(open('/tmp/p_tc.json'))
c = d.get('choices')
if not c: print('-'); raise SystemExit
calls = (c[0].get('message') or {}).get('tool_calls') or []
if not calls: print('-'); raise SystemExit
fn = calls[0].get('function') or {}
ok = 'yes'
try:
    a = json.loads(fn.get('arguments') or '{}')
    ok = 'yes' if isinstance(a, dict) and a.get('city') else 'no'
except Exception:
    ok = 'no'
print(f"{c[0].get('finish_reason')}|{ok}")
PY
)
  fr="${tc%%|*}"; av="${tc##*|}"

  # 2. the loop turn — can it consume a tool result and answer?
  loop="-"
  if [ "$fr" = "tool_calls" ]; then
    curl -sS -m 90 -o /tmp/p_loop.json -X POST "$BASE/chat/completions" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $KEY" \
      -d "{\"model\":\"$m\",\"max_tokens\":2048,\"messages\":[{\"role\":\"user\",\"content\":\"What is the weather in Paris? Use the get_weather tool.\"},{\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"{\\\"city\\\": \\\"Paris\\\"}\"}}]},{\"role\":\"tool\",\"tool_call_id\":\"call-1\",\"content\":\"12C, light rain\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get weather\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}]}" \
      2>/dev/null
    loop=$(python3 -c "
import json
d=json.load(open('/tmp/p_loop.json'))
c=(d.get('choices') or [{}])[0]
t=((c.get('message') or {}).get('content') or '')
print('yes' if '12' in t and c.get('finish_reason')=='stop' else ('partial' if t else 'no'))
" 2>/dev/null || echo "no")
  fi

  # 3. streaming — a coding agent reads every token live
  frames=$(curl -sS -N -m 90 -X POST "$BASE/chat/completions" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $KEY" \
    -d "{\"model\":\"$m\",\"max_tokens\":512,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Count 1 to 3.\"}]}" \
    2>/dev/null | grep -c '^data:')

  # 4. /v1/messages — the Anthropic-native path LiteLLM forwards untranslated
  msg=$(curl -sS -m 90 -o /tmp/p_msg.json -w '%{http_code}' -X POST "$BASE/messages" \
    -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
    -d "{\"model\":\"$m\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: OK\"}]}" 2>/dev/null)
  [ "$msg" = "200" ] && msg="200" || msg="x$msg"

  verdict=$(python3 -c "
import sys
fr, av, loop, frames, msg = sys.argv[1:6]
if fr == 'tool_calls' and av == 'yes' and loop == 'yes' and int(frames) > 1 and msg == '200':
    print('AGENTIC')
elif fr == 'tool_calls' and av == 'yes' and int(frames) > 1:
    print('partial')
else:
    print('no')
" "$fr" "$av" "$loop" "$frames" "$msg")

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$m" "$code" "$fr" "$av" "$loop" "$frames" "$msg" "$verdict" >> "$OUT"
  echo "  $m -> $verdict (tc=$fr args=$av loop=$loop sse=$frames msgs=$msg)"
  sleep 2
done

echo
echo "=== AGENTIC-QUALIFIED ==="
awk -F'\t' 'NR>1 && $8=="AGENTIC"{print "  "$1}' "$OUT"
