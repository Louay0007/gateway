#!/usr/bin/env bash
# Nightly Postgres backup — BOTH databases.  crontab: 17 3 * * *
#
# One archive, two dumps. The portal database holds every number the
# business runs on — subscriptions, invoices-to-be, the usage ledger that
# Stripe meters are computed from. Losing it is not an inconvenience; it
# is the company. Backing up only `litellm` (as this script used to) was
# a gap that would have been discovered on the worst possible day.
#
# Restore with: make restore FILE=backup-<stamp>.tar.gz
set -euo pipefail
cd /opt/gateway

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="backup-${STAMP}.tar.gz"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for db in litellm portal; do
  # pg_dump is logical and schema-only changes are captured, but roles and
  # grants are not: the `litellm` role is recreated by POSTGRES_USER on
  # container init, which is why that variable must stay in .env.
  docker compose exec -T postgres pg_dump -U litellm "$db" > "$STAGE/${db}.sql"
  if [ ! -s "$STAGE/${db}.sql" ]; then
    # An empty dump is almost always a connection or permission problem,
    # and shipping it as "today's backup" silently destroys the previous
    # good one after 7 days.
    echo "FATAL: dump of ${db} is empty — refusing to archive" >&2
    exit 1
  fi
done

tar -czf "$ARCHIVE" -C "$STAGE" litellm.sql portal.sql

# Off-site, encrypted copy
aws s3 cp "$ARCHIVE" "s3://${BACKUP_BUCKET:-your-backups}/gateway/" \
  --sse AES256 --storage-class STANDARD_IA

find . -name 'backup-*.tar.gz' -mtime +7 -delete

echo "backup ok: $ARCHIVE"
echo
echo "REMINDER: is LITELLM_SALT_KEY backed up separately? It is NOT in"
echo "this dump. Losing it makes every stored provider credential"
echo "permanently unreadable."
