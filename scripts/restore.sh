#!/usr/bin/env bash
# Restore both databases from a backup archive.
#
#   make restore FILE=backup-20261011T031700Z.tar.gz
#
# DESTRUCTIVE BY DESIGN: this DROPS and recreates both databases. A restore
# that merges into a live database produces a half-restored system that
# looks healthy and bills wrong — worse than an outage. The confirmation
# step is deliberate friction, not a formality.
#
# This is the drill behind IMPLEMENTATION.md §9 ("Backup restores both
# databases"). Run it on a scratch cluster before launch; a backup you
# have never restored is a hypothesis, not a backup.
set -euo pipefail
cd /opt/gateway

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: make restore FILE=backup-<stamp>.tar.gz" >&2
  exit 1
fi

echo "This will DROP and recreate BOTH databases (litellm, portal)."
echo "Everything currently in them is lost."
printf 'Type the hostname to confirm: '
read -r CONFIRM
if [ "$CONFIRM" != "$(hostname)" ]; then
  echo "aborted — confirmation did not match" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$FILE" -C "$STAGE"

for db in litellm portal; do
  if [ ! -s "$STAGE/${db}.sql" ]; then
    echo "FATAL: archive is missing ${db}.sql — refusing a partial restore" >&2
    exit 1
  fi
done

# Terminate lingering connections first: DROP DATABASE fails if anything
# is attached, and the portal/litellm containers hold pools open.
docker compose stop portal jobs litellm >/dev/null

for db in litellm portal; do
  echo "  restoring ${db}…"
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U litellm -d postgres \
    -c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" \
    -c "CREATE DATABASE ${db}"

  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U litellm -d "$db" \
    < "$STAGE/${db}.sql"
done

# The migration ledger lives inside the portal dump, so restored state and
# "what has been applied" agree. Recreate it defensively in case the
# archive predates the ledger.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U litellm -d portal \
  -c "CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now())" >/dev/null

docker compose up -d
echo "restore complete — run 'make health'"
