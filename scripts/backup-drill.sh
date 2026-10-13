#!/usr/bin/env bash
# Backup RESTORE DRILL — the half of backup that is never tested.
#
# A backup nobody has restored is a rumour (PLATFORM.md §11: the drill
# is the gate, not the dump). This script:
#
#   1. Dumps the live portal database.
#   2. Creates a scratch database (`portal_drill`).
#   3. Restores the dump into it.
#   4. Runs sanity checks that must hold for the data to be usable.
#   5. DROPS the scratch database.
#
# It never touches the live database, and it fails loudly on any step —
# a drill that passes while the restore is broken must not exist.
#
# Usage: make backup-drill   (or ./scripts/backup-drill.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

DRILL_DB="portal_drill"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"; docker compose exec -T postgres psql -U litellm -d postgres -c "DROP DATABASE IF EXISTS '"$DRILL_DB"'" >/dev/null 2>&1 || true' EXIT

echo "  1/5 dumping the live portal database"
docker compose exec -T postgres pg_dump -U litellm portal > "$STAGE/portal.sql"
if [ ! -s "$STAGE/portal.sql" ]; then
  echo "  FATAL: dump is empty — nothing to drill with" >&2
  exit 1
fi

echo "  2/5 creating scratch database ${DRILL_DB}"
docker compose exec -T postgres psql -U litellm -d postgres \
  -c "DROP DATABASE IF EXISTS ${DRILL_DB}" >/dev/null
docker compose exec -T postgres psql -U litellm -d postgres \
  -c "CREATE DATABASE ${DRILL_DB}" >/dev/null

echo "  3/5 restoring into ${DRILL_DB}"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U litellm -d "$DRILL_DB" \
  < "$STAGE/portal.sql" >/dev/null

echo "  4/5 sanity checks"
fail=0

# The checks below are the ones that mean "the business survives":
# plans exist (nothing can be sold without them), the ledger is present
# and non-empty, migrations are recorded, and subscriptions reconcile
# with entitlements. Extend as the schema grows.
check() {
  local label="$1" query="$2"
  local value
  value=$(docker compose exec -T postgres psql -U litellm -d "$DRILL_DB" -tAc "$query" 2>/dev/null || echo "ERR")
  if [ "$value" = "ERR" ]; then
    echo "  FAIL ${label} (query failed)"; fail=1; return
  fi
  echo "  ${label}: ${value}"
}

plans=$(docker compose exec -T postgres psql -U litellm -d "$DRILL_DB" -tAc \
  "SELECT count(*) FROM plans" 2>/dev/null || echo ERR)
ledger=$(docker compose exec -T postgres psql -U litellm -d "$DRILL_DB" -tAc \
  "SELECT count(*) FROM usage_records" 2>/dev/null || echo ERR)
migrations=$(docker compose exec -T postgres psql -U litellm -d "$DRILL_DB" -tAc \
  "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo ERR)
orphans=$(docker compose exec -T postgres psql -U litellm -d "$DRILL_DB" -tAc \
  "SELECT count(*) FROM entitlements e LEFT JOIN subscriptions s ON s.organization_id = e.organization_id AND s.status IN ('trialing','active','past_due','paused') WHERE s.id IS NULL" 2>/dev/null || echo ERR)

[ "$plans" -ge 2 ] 2>/dev/null || { echo "  FAIL expected >= 2 plans, got ${plans}"; fail=1; }
[ "$ledger" -ge 1 ] 2>/dev/null || { echo "  FAIL expected >= 1 ledger row, got ${ledger}"; fail=1; }
[ "$migrations" -ge 4 ] 2>/dev/null || { echo "  FAIL expected >= 4 migrations, got ${migrations}"; fail=1; }
# Orphan entitlements are legal (a canceled org's cache row survives a
# cancel+sync as a cut), so this is reported, not failed on.
echo "  plans=${plans} ledger_rows=${ledger} migrations=${migrations} entitlements_without_live_sub=${orphans}"

echo "  5/5 dropping ${DRILL_DB}"
# The EXIT trap drops it; this is the visible half.

if [ "$fail" -ne 0 ]; then
  echo "  DRILL FAILED" >&2
  exit 1
fi
echo "  drill passed — a restore from this dump would be usable"
