#!/usr/bin/env bash
# Mint a scoped tenant key.
#   usage: issue-key.sh <alias> <models-csv> <max-budget-usd> <duration>
#   e.g.   issue-key.sh acme "fast,smart" 50.00 30d
set -euo pipefail

ALIAS="${1:?alias required}"
MODELS="${2:?models csv required, e.g. fast,smart}"
BUDGET="${3:?max budget usd required}"
DURATION="${4:?budget_duration, e.g. 30d}"

: "${LITELLM_MASTER_KEY:?export LITELLM_MASTER_KEY first}"

# Always set user_id at creation. Clients can otherwise move their spend
# to an arbitrary end_user_id via the request body's "user" field.
USER_ID="${ALIAS}"

# ── Dev-phase defaults for ~120 users on one fair-use upstream ──────
# Override per key: ISSUE_RPM=60 ISSUE_TPM=200000 ISSUE_CONC=5 ./issue-key.sh …
# Aggregate worst case must stay under the provider's hidden ceiling.
# Nobody hits the theoretical max at once in dev, but if 429s appear,
# lower THESE first, not the VPS. Tune from real 429/TTFT data in
# week 1 (LATENCY.md §4.4), not from guesses.
RPM="${ISSUE_RPM:-30}"
TPM="${ISSUE_TPM:-50000}"
CONC="${ISSUE_CONC:-3}"

MODEL_JSON=$(printf '%s' "$MODELS" \
  | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')

curl -sS -X POST 'http://127.0.0.1:4000/key/generate' \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{
        \"key_alias\":      \"${ALIAS}\",
        \"user_id\":        \"${USER_ID}\",
        \"models\":         [${MODEL_JSON}],
        \"max_budget\":     ${BUDGET},
        \"budget_duration\": \"${DURATION}\",
        \"rpm_limit\":      ${RPM},
        \"tpm_limit\":      ${TPM},
        \"max_parallel_requests\": ${CONC},
        \"metadata\":       { \"owner\": \"${USER_ID}\" }
      }" | jq '{key, key_name, max_budget, budget_duration, models, expires}'

# The JSON above is the ONLY thing on stdout, so callers can pipe it
# straight into jq / json.load. Human guidance goes to stderr instead —
# trailing text on stdout makes every downstream parse fail on "Extra data".
FIRST_MODEL=$(printf '%s' "$MODELS" | cut -d, -f1)
cat >&2 <<EOF

Test it before handing it out:
  curl -s https://${API_DOMAIN}/v1/chat/completions \\
    -H "Authorization: Bearer <KEY>" \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"${FIRST_MODEL}","messages":[{"role":"user","content":"hi"}]}'
EOF