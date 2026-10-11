#!/bin/sh
# Create the `portal` database. Run by postgres on FIRST BOOT only
# (docker-entrypoint-initdb.d); `make db-init` does the same thing on an
# existing cluster, and is the path that matters after the first deploy.
#
# SHELL FORM, not SQL: CREATE DATABASE cannot run inside a DO block or a
# transaction (Postgres refuses both — it is a utility statement with
# session-level effects). Guarding with a catalog lookup in a DO block is
# the workaround, and it is what this script does.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT 'CREATE DATABASE portal'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'portal')\gexec
SQL

# The portal connects as the same role in v1 (PLATFORM.md §1.1). A
# separate `portal` role is a growth-stage change: it only earns its keep
# once portal credentials must be revocable independently of LiteLLM's.
echo "portal database ready"
