#!/usr/bin/env bash
# reconcile.sh — independent cost verification. DESIGN.md §7.
#
# Compares three sources that should agree:
#   1. LiteLLM's reported spend
#   2. A recomputation from raw usage using prices/models.yaml
#   3. The upstream provider's Usage & Cost API (when available)
#
#   usage: LITELLM_MASTER_KEY=... ./scripts/reconcile.sh [days]
set -uo pipefail

DAYS="${1:-30}"
LOCAL="http://127.0.0.1:4000"
: "${LITELLM_MASTER_KEY:?export LITELLM_MASTER_KEY first}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

hr; printf '  RECONCILIATION — last %s days\n' "$DAYS"; hr

# ── 1. LiteLLM's own spend rollup ─────────────────────────────────
curl -sS -m 60 "$LOCAL/global/spend/report?start_date=$(date -u -d "${DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -u -v-${DAYS}d +%Y-%m-%d)&end_date=$(date -u +%Y-%m-%d)" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" > /tmp/recon_litellm.json 2>/dev/null
if [ -s /tmp/recon_litellm.json ]; then
  printf '  LiteLLM total spend : %s\n' \
    "$(python3 -c 'import json;d=json.load(open("/tmp/recon_litellm.json"));print(f"${d.get("total_spend",0):.6f}")' 2>/dev/null || echo 'n/a')"
else
  echo "  LiteLLM total spend : (report endpoint unavailable)"
fi

# ── 2. Recompute from raw usage ───────────────────────────────────
# Reads LiteLLM's spend logs and re-prices every row from prices/models.yaml.
# This is the check that catches the merged-cache-TTL bug (ccusage #899):
# if LiteLLM priced all cache_creation at 1.25x while the workload used
# 1h TTL at 2.0x, this recomputation will exceed LiteLLM's total.
python3 - "$HERE/prices/models.yaml" "$DAYS" <<'PY'
import json, sys, urllib.request, os, datetime

prices_path, days = sys.argv[1], int(sys.argv[2])

try:
    import yaml
    prices = yaml.safe_load(open(prices_path))["models"]
except Exception as e:
    print(f"  ⚠️  cannot read {prices_path}: {e}")
    sys.exit(0)

start = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
end = datetime.date.today().isoformat()

req = urllib.request.Request(
    f"http://127.0.0.1:4000/spend/logs/ui?start_date={start}&end_date={end}",
    headers={"Authorization": f"Bearer {os.environ['LITELLM_MASTER_KEY']}"})
try:
    rows = json.load(urllib.request.urlopen(req, timeout=60))
except Exception as e:
    print(f"  ⚠️  cannot read spend logs: {e}")
    sys.exit(0)

# LiteLLM's spend-log schema varies by version; handle the shapes we have seen.
rows = rows if isinstance(rows, list) else rows.get("data", rows.get("spend_logs", []))

M = 1_000_000
total = 0.0
unpriced = {}
missing_ttl_split = 0

for r in rows:
    model = r.get("model") or ""
    u = r.get("usage") or {}
    cc = u.get("cache_creation") or {}
    w5 = cc.get("ephemeral_5m_input_tokens", 0) or 0
    w1 = cc.get("ephemeral_1h_input_tokens", 0) or 0

    # THE BUG THIS CATCHES: merged cache_creation_input_tokens with no
    # TTL breakdown. We fall back to the 5m rate and flag the row.
    ccit = u.get("cache_creation_input_tokens", 0) or 0
    if ccit and not (w5 or w1):
        w5 = ccit
        missing_ttl_split += 1

    p = prices.get(model)
    if not p:
        base = model.split("/")[-1]
        p = next((v for k, v in prices.items() if k in model or base.startswith(k)), None)
    if not p:
        unpriced[model] = unpriced.get(model, 0) + 1
        continue

    total += (
        (u.get("input_tokens", 0) or 0)              / M * p["input_per_mtok"]
      + (u.get("output_tokens", 0) or 0)             / M * p["output_per_mtok"]
      + w5                                           / M * p["cache_write_5m_per_mtok"]
      + w1                                           / M * p["cache_write_1h_per_mtok"]
      + (u.get("cache_read_input_tokens", 0) or 0)   / M * p["cache_read_per_mtok"]
    )

print(f"  Recomputed from {len(rows)} spend logs : ${total:.6f}")
if missing_ttl_split:
    print(f"  ⚠️  {missing_ttl_split} rows had cache_creation with NO TTL breakdown.")
    print("     Priced at the 5m rate (1.25x). If those were 1h writes (2.0x),")
    print("     the true total is up to ~19% higher. Fix the provider or accept.")
if unpriced:
    print(f"  ⚠️  unpriced models (add to prices/models.yaml): {unpriced}")
PY

# ── 3. Upstream provider Usage & Cost API ─────────────────────────
# Only for first-party Anthropic keys. Third-party resellers will not
# have this endpoint — that absence is itself a finding: see
# BLUEPRINT.md §2.3 (you cannot verify a provider's usage reporting).
hr
if [ -n "${UPSTREAM_BASE_URL:-}" ] && [ "${UPSTREAM_BASE_URL}" = "https://api.anthropic.com" ]; then
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  SINCE=$(date -u -v-${DAYS}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ)
  UP=$(curl -sS -m 90 -G "https://api.anthropic.com/v1/organizations/usage_report/messages" \
       -H "x-api-key: ${UPSTREAM_API_KEY:-}" \
       -H 'anthropic-version: 2023-06-01' \
       --data-urlencode "starting_at=$SINCE" \
       --data-urlencode "ending_at=$NOW" \
       --data-urlencode "bucket_width=1d" 2>/dev/null)
  if printf '%s' "$UP" | grep -q 'data'; then
    printf '  Upstream Usage API : reachable\n'
    printf '%s' "$UP" | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d.get("data", [])
print(f"    buckets returned : {len(rows)}")
' 2>/dev/null
    echo "    Diff these token counts against the gateway ledger by hand."
  else
    echo "  Upstream Usage API : not available for this credential."
    echo "    If the upstream is a third-party reseller this is expected."
    echo "    NOTE: it also means you cannot independently verify their"
    echo "    reporting. See BLUEPRINT.md §2.3."
  fi
else
  echo "  Upstream Usage API : skipped (not first-party Anthropic)"
  echo "    You have NO independent source for token truth. Cost accuracy"
  echo "    rests entirely on the gateway's own parsing."
fi
hr