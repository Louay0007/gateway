#!/usr/bin/env bash
# measure-latency.sh — per-layer latency measurement. LATENCY.md §9.
#
# Splits one streaming request into: dns, tcp, tls, ttft, total,
# effective decode throughput, and LiteLLM's own overhead header.
# Run weekly from two locations; append to CSV for SLA evidence.
#
#   usage: ./scripts/measure-latency.sh --base https://api.yourdomain.com \
#            --key sk-... [--model fast] [--samples 50] [--csv latency.csv]

set -uo pipefail

BASE=""; KEY=""; MODEL="fast"; SAMPLES=50; CSV=""

while [ $# -gt 0 ]; do
  case "$1" in
    --base)    BASE="${2:?}"; shift 2 ;;
    --key)     KEY="${2:?}"; shift 2 ;;
    --model)   MODEL="$2"; shift 2 ;;
    --samples) SAMPLES="$2"; shift 2 ;;
    --csv)     CSV="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -n "$BASE" ] && [ -n "$KEY" ] || {
  echo "usage: $0 --base <url> --key <sk-...> [--model fast] [--samples 50] [--csv out.csv]" >&2
  exit 2
}

PROMPT="Reply with exactly: ok"
BODY=$(printf '{"model":"%s","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"%s"}]}' \
  "$MODEL" "$PROMPT")

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

pct() { # pct <p> <file> — nearest-rank percentile, seconds with 3dp
  local p="$1" f="$2" n
  n=$(wc -l < "$f" | tr -d ' ')
  [ "$n" -eq 0 ] && { echo "n/a"; return; }
  local k; k=$(( (p * n + 99) / 100 )); [ "$k" -lt 1 ] && k=1
  sort -n "$f" | sed -n "${k}p" | awk '{printf "%.3f", $1}'
}

: > "$tmpdir/dns"   ; : > "$tmpdir/tcp" ; : > "$tmpdir/tls"
: > "$tmpdir/ttft"  ; : > "$tmpdir/tot" ; : > "$tmpdir/tps" ; : > "$tmpdir/ovh"

echo "measuring $SAMPLES streaming request(s): $BASE/v1/chat/completions model=$MODEL"

i=0; ok=0
while [ "$i" -lt "$SAMPLES" ]; do
  i=$((i+1))
  hdr="$tmpdir/h.$i"; out="$tmpdir/b.$i"

  # time_starttransfer on a stream = first byte = TTFT proxy.
  # x-litellm-overhead-duration-ms = LiteLLM's self-reported overhead.
  stats=$(curl -sS -m 120 -D "$hdr" -o "$out" -w \
    '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{http_code}' \
    -X POST "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $KEY" \
    -H 'Content-Type: application/json' \
    -d "$BODY" 2>/dev/null) || { printf '  sample %d: curl failed\n' "$i"; continue; }

  set -- $stats
  dns="$1"; tcp="$2"; tls="$3"; ttft="$4"; tot="$5"; code="$6"

  [ "$code" = "200" ] || { printf '  sample %d: http %s\n' "$i" "$code"; continue; }

  # Effective decode throughput from the stream: count content chunks,
  # divide by (total - ttft). Approximate — SSE framing, not tokens —
  # so label it as such. True TPS needs usage.completion_tokens.
  chunks=$(grep -c '^data:' "$out" 2>/dev/null || echo 0)
  tps=$(awk -v c="$chunks" -v t="$tot" -v f="$ttft" \
    'BEGIN{d=t-f; printf "%.1f", (d>0.01 ? c/d : 0)}')

  ovh=$(grep -i '^x-litellm-overhead-duration-ms:' "$hdr" \
    | tr -d '\r' | awk '{print $2}' | head -1)
  [ -z "$ovh" ] && ovh="0"

  printf '%s\n' "$dns"  >> "$tmpdir/dns"
  printf '%s\n' "$tcp"  >> "$tmpdir/tcp"
  printf '%s\n' "$tls"  >> "$tmpdir/tls"
  printf '%s\n' "$ttft" >> "$tmpdir/ttft"
  printf '%s\n' "$tot"  >> "$tmpdir/tot"
  printf '%s\n' "$tps"  >> "$tmpdir/tps"
  printf '%s\n' "$ovh"  >> "$tmpdir/ovh"
  ok=$((ok+1))
  printf '  sample %d/%d: ttft=%ss total=%ss chunks=%s overhead=%sms\n' \
    "$i" "$SAMPLES" "$ttft" "$tot" "$chunks" "$ovh"
done

echo
echo "═══════════════════════════════════════════════════"
printf '  samples ok : %d/%d\n' "$ok" "$SAMPLES"
printf '  dns        : p50 %ss   p95 %ss\n' "$(pct 50 "$tmpdir/dns")" "$(pct 95 "$tmpdir/dns")"
printf '  tcp        : p50 %ss   p95 %ss\n' "$(pct 50 "$tmpdir/tcp")" "$(pct 95 "$tmpdir/tcp")"
printf '  tls        : p50 %ss   p95 %ss\n' "$(pct 50 "$tmpdir/tls")" "$(pct 95 "$tmpdir/tls")"
printf '  ttft       : p50 %ss   p95 %ss\n' "$(pct 50 "$tmpdir/ttft")" "$(pct 95 "$tmpdir/ttft")"
printf '  total      : p50 %ss   p95 %ss\n' "$(pct 50 "$tmpdir/tot")" "$(pct 95 "$tmpdir/tot")"
printf '  chunks/s   : p50 %s   p95 %s   (SSE chunks, ≈ tokens)\n' \
  "$(pct 50 "$tmpdir/tps")" "$(pct 95 "$tmpdir/tps")"
printf '  litellm overhead: p50 %sms   p99 %sms\n' \
  "$(pct 50 "$tmpdir/ovh")" "$(pct 99 "$tmpdir/ovh")"
echo "═══════════════════════════════════════════════════"

if [ -n "$CSV" ]; then
  [ -f "$CSV" ] || echo "ts,model,ok,dns_p50,tcp_p50,tls_p50,ttft_p50,ttft_p95,total_p50,total_p95,ovh_p99" > "$CSV"
  printf '%s,%s,%d,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$(date -u +%FT%TZ)" "$MODEL" "$ok" \
    "$(pct 50 "$tmpdir/dns")" "$(pct 50 "$tmpdir/tcp")" "$(pct 50 "$tmpdir/tls")" \
    "$(pct 50 "$tmpdir/ttft")" "$(pct 95 "$tmpdir/ttft")" \
    "$(pct 50 "$tmpdir/tot")" "$(pct 95 "$tmpdir/tot")" \
    "$(pct 99 "$tmpdir/ovh")" >> "$CSV"
  echo "  appended to $CSV"
fi

echo
echo "Interpretation (LATENCY.md §4.2):"
echo "  ttft  ≈ client→VPS RTT + ~4ms gateway + VPS→upstream RTT + queue+prefill"
echo "  total ≈ ttft + decode. Gateway share should be <0.5% of total."
echo "  If litellm overhead p99 climbs while ttft is flat, check Redis and"
echo "  in_flight_requests — queue wait is invisible to LiteLLM's own logs."