#!/usr/bin/env bash
# Usage reports against the local gateway (loopback, never public).
#   usage: report.sh <user_id> [days]
set -euo pipefail

USER_ID="${1:?user_id required}"
DAYS="${2:-30}"
: "${LITELLM_MASTER_KEY:?export LITELLM_MASTER_KEY first}"

BASE="http://127.0.0.1:4000"
AUTH="Authorization: Bearer ${LITELLM_MASTER_KEY}"

echo "=== spend ==="
curl -s "$BASE/user/info?user_id=$USER_ID" -H "$AUTH" | jq '.user_info'

echo
echo "=== daily activity (last ${DAYS} days) ==="
curl -s "$BASE/user/daily/activity?user_id=$USER_ID" -H "$AUTH" \
  | jq -r '.daily_spend[]? | "\(.date)  requests=\(.requests)  tokens=\(.tokens)  usd=\(.spend)"'

echo
echo "=== per-key spend ==="
curl -s "$BASE/key/info" -H "$AUTH" \
  | jq -r '.spend_logs[]? | "\(.key_alias // .key_name)  usd=\(.spend)  models=\(.models // "-")"'

echo
echo "NOTE: gateway request counts and spend-log-derived counts are"
echo "different sources and are NOT expected to tie out exactly. See"
echo "BLUEPRINT.md section 10.4."