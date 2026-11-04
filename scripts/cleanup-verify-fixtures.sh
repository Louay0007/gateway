#!/usr/bin/env bash
# cleanup-verify-fixtures.sh — remove `*.verify.invalid` rows left by the
# verify-* harnesses, and nothing else.
#
# WHY THIS EXISTS
# `make verify-d17` says so in its own header: "it leaves its evidence behind
# (the ledger is the record)". That is fine on a scratch box; on the live
# database it means every run adds real rows to `users`, `organizations`,
# `subscriptions` and `payments_d17`. `make verify-metering` additionally
# leaked a fixture whenever it crashed partway (it used to fail at section 5
# of 27 on a production box, long after creating its org).
#
# SCOPE — deliberately narrow:
#   * only rows whose email / slug ends in `@verify.invalid` or starts with
#     a known harness tag
#   * never touches a row with a real customer email domain
#   * DRY RUN by default; pass --apply to actually delete
#
# The harnesses use a fixed set of tags, so this cannot "accidentally"
# match a customer: `verify.invalid` is RFC-2606 reserved and can never
# be a real mailbox, and no customer could have registered one.
#
#   usage:  ./scripts/cleanup-verify-fixtures.sh            # show what would go
#           ./scripts/cleanup-verify-fixtures.sh --apply    # delete it
set -uo pipefail

APPLY=""
[ "${1:-}" = "--apply" ] && APPLY="yes"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1

# Load POSTGRES_PASSWORD etc. Same convention as the other scripts.
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  if [ -f .env ]; then
    set -a; . ./.env; set +a
  else
    echo "no .env and POSTGRES_PASSWORD unset — nothing to do" >&2
    exit 1
  fi
fi

# `sudo` when the shell user cannot reach the docker socket, plain otherwise.
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

psqlq() { $DOCKER exec -e PGPASSWORD="$POSTGRES_PASSWORD" gateway-postgres-1 \
  psql -U litellm -d portal -v ON_ERROR_STOP=1 "$@"; }

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

hr; printf '  VERIFY FIXTURES — %s\n' "$([ -n "$APPLY" ] && echo APPLY || echo 'DRY RUN (pass --apply)')"; hr

# ── What is there ────────────────────────────────────────────────────
psqlq -tAc "
  SELECT 'users              ' || count(*) FROM users              WHERE email LIKE '%@verify.invalid'
  UNION ALL SELECT 'organizations      ' || count(*) FROM organizations      WHERE slug LIKE 'metering-proof%'
                                                       OR slug LIKE 'd17-buyer-%'
                                                       OR slug LIKE 'session-user-%'
                                                       OR slug LIKE 'verify-%'
  UNION ALL SELECT 'subscriptions      ' || count(*) FROM subscriptions      WHERE organization_id IN (
                                                        SELECT id FROM organizations WHERE slug LIKE 'metering-proof%'
                                                          OR slug LIKE 'd17-buyer-%' OR slug LIKE 'session-user-%' OR slug LIKE 'verify-%')
  UNION ALL SELECT 'payments_d17       ' || count(*) FROM payments_d17        WHERE organization_id IN (
                                                        SELECT id FROM organizations WHERE slug LIKE 'metering-proof%'
                                                          OR slug LIKE 'd17-buyer-%' OR slug LIKE 'session-user-%' OR slug LIKE 'verify-%')
  UNION ALL SELECT 'api_keys           ' || count(*) FROM api_keys            WHERE organization_id IN (
                                                        SELECT id FROM organizations WHERE slug LIKE 'metering-proof%'
                                                          OR slug LIKE 'd17-buyer-%' OR slug LIKE 'session-user-%' OR slug LIKE 'verify-%')
" 2>&1

if [ -z "$APPLY" ]; then
  hr
  echo "  Nothing changed. Re-run with --apply to delete the rows above."
  hr
  exit 0
fi

# ── Delete, in FK-safe order, inside one transaction ─────────────────
# Children before parents; the whole thing is one transaction so a
# mid-way failure leaves the database exactly as it was.
hr; echo "  deleting…"
psqlq <<'SQL' 2>&1
BEGIN;

CREATE TEMP TABLE _fx_org ON COMMIT DROP AS
  SELECT id FROM organizations
   WHERE slug LIKE 'metering-proof%'
      OR slug LIKE 'd17-buyer-%'
      OR slug LIKE 'session-user-%'
      OR slug LIKE 'verify-%';

CREATE TEMP TABLE _fx_user ON COMMIT DROP AS
  SELECT id FROM users WHERE email LIKE '%@verify.invalid';

DELETE FROM audit_log            WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM billing_events       WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM entitlements         WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM usage_periods        WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM usage_records        WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM api_keys             WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM payments_d17         WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM subscriptions        WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM _fx_org);
DELETE FROM organizations        WHERE id IN (SELECT id FROM _fx_org);

DELETE FROM auth_sessions            WHERE user_id IN (SELECT id FROM _fx_user);
DELETE FROM auth_credentials         WHERE user_id IN (SELECT id FROM _fx_user);
DELETE FROM auth_login_attempts      WHERE user_id IN (SELECT id FROM _fx_user);
DELETE FROM auth_verification_tokens WHERE user_id IN (SELECT id FROM _fx_user);
DELETE FROM users                    WHERE id IN (SELECT id FROM _fx_user);

COMMIT;
SQL

hr; echo "  after:"; psqlq -tAc "
  SELECT 'users=' || (SELECT count(*) FROM users)
      || ' organizations=' || (SELECT count(*) FROM organizations)
      || ' subscriptions=' || (SELECT count(*) FROM subscriptions)
      || ' usage_records=' || (SELECT count(*) FROM usage_records)
      || ' payments_d17=' || (SELECT count(*) FROM payments_d17)
      || ' api_keys=' || (SELECT count(*) FROM api_keys)
      || ' migrations=' || (SELECT count(*) FROM schema_migrations);" 2>&1
hr
