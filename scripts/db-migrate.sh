#!/usr/bin/env bash
# Apply pending portal migrations, in order, exactly once each.
#
# WHY psql AND NOT `npm run db:migrate`: drizzle-kit is a devDependency,
# and the deployed portal image is a `output: 'standalone'` bundle that
# ships no devDependencies at all. Piping plain .sql into the postgres
# container needs nothing installed on the VPS and works identically for
# hand-written migrations (0001, 0002) and drizzle-kit-generated ones
# (0003+).
#
# Ledger: a schema_migrations table records what has been applied. Without
# it, "is this migration already applied?" is unanswerable from SQL alone,
# and re-running 0001 fails on CREATE TABLE — which is the correct failure,
# but only after someone deploys the wrong thing.
#
# Safe to run on every deploy. Migrations must be FORWARD-ONLY and must
# not run inside a transaction that also does data work (drizzle-kit emits
# one statement per file for that reason).
set -euo pipefail

# Resolve the repo root from this script's location, not a hardcoded VPS
# path — the same script must work locally (git clone) and on the VPS
# (/opt/gateway). docker compose then finds docker-compose.yml there.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

MIGRATIONS=(portal/db/migrations/*.sql)
if [ ! -e "${MIGRATIONS[0]}" ]; then
  echo "  no migrations found" >&2
  exit 1
fi

psql_portal() {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U litellm -d portal "$@"
}

# The ledger is ours, not drizzle-kit's: keeping it separate means a
# drizzle-kit push can never silently desynchronise from what is deployed.
psql_portal -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null

applied=0
for file in "${MIGRATIONS[@]}"; do
  name=$(basename "$file")

  if psql_portal -tAc \
       "SELECT 1 FROM schema_migrations WHERE name='${name}'" | grep -q 1; then
    echo "  skip    ${name}"
    continue
  fi

  # ON_ERROR_STOP=1 aborts on the first error, so a half-applied file is
  # impossible: psql exits non-zero and the ledger is not updated.
  psql_portal -f - < "$file" >/dev/null
  psql_portal -c "INSERT INTO schema_migrations (name) VALUES ('${name}')" >/dev/null

  echo "  applied ${name}"
  applied=$((applied + 1))
done

echo "  migrations: ${applied} applied"
