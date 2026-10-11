#!/usr/bin/env bash
# Idempotently create the `portal` database.
#
# WHY THIS EXISTS ALONGSIDE portal/db/init/01-portal-db.sh: Docker runs
# entrypoint scripts exactly once, when the data volume is empty. On a VPS
# whose cluster was created before the portal existed, that script never
# fires again. Run this after any upgrade that adds a database, and it is
# safe to run every time.
set -euo pipefail
# Resolve the repo root from this script's location, not a hardcoded VPS
# path — the same script must work locally (git clone) and on the VPS
# (/opt/gateway). docker compose then finds docker-compose.yml there.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if docker compose exec -T postgres psql -U litellm -d litellm -tAc \
     "SELECT 1 FROM pg_database WHERE datname='portal'" | grep -q 1; then
  echo "  portal database : already exists"
else
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U litellm -d litellm \
    -c "CREATE DATABASE portal"
  echo "  portal database : created"
fi
