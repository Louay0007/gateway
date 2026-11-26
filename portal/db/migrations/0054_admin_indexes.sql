-- ══════════════════════════════════════════════════════════════════════════
--  0054_admin_indexes.sql — the read paths the management console adds
--
--  Same reasoning as 0015: the console could already WRITE more than it could
--  READ, and every screen added by the management work (customers, payments,
--  subscriptions, trials, recovery) is an aggregate or a search over a table
--  that only grows. Without these, opening /admin/payments on a mature install
--  is a sequential scan of the whole ledger.
--
--  PURE PERFORMANCE. Every query these serve is written in lib/admin/*.ts and
--  asserted by tests/admin-*.test.ts. No behaviour change here.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Customers: find a person by email or name ────────────────────────
-- The console's search box is a substring match (ILIKE '%…%') over both
-- columns, which no btree index can serve. pg_trgm is standard Postgres and
-- present on the target image; IF NOT EXISTS makes a re-run harmless.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (lower(email) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (lower(name) gin_trgm_ops);

-- Newest-first is the roster's default order and its count query.
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at DESC);

-- ── 2. A person's path to their orgs ────────────────────────────────────
-- "Which orgs does this user belong to" is the FIRST query on the person
-- page. The existing indexes lead with organization_id, so they cannot
-- serve it.
CREATE INDEX IF NOT EXISTS org_members_user_idx
  ON organization_members (user_id);

-- ── 3. Payments: one ledger across every org ────────────────────────────
-- Existing: (submitted_at), (sender_phone, submitted_at), and two
-- per-subscription ones. None serves "every payment, newest first, filtered
-- by status", which is /admin/payments' default view.
CREATE INDEX IF NOT EXISTS payments_d17_created_idx
  ON payments_d17 (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_d17_status_created_idx
  ON payments_d17 (status, created_at DESC);

-- A disputed transfer is identified by the phone number that sent it, and
-- the operator only has a partial number ("it ended 4471").
CREATE INDEX IF NOT EXISTS payments_d17_phone_trgm_idx
  ON payments_d17 USING gin (sender_phone gin_trgm_ops);

-- ── 4. Failed webhooks: the query nothing has ever run ──────────────────
-- billing_events has one index, on received_at. The view that matters is
-- "unprocessed, worst first" — an event that has failed five times is the
-- one a human must look at, and a partial index keeps it small.
CREATE INDEX IF NOT EXISTS billing_events_failed_idx
  ON billing_events (attempts DESC, received_at ASC)
  WHERE processed_at IS NULL;

-- ── 5. Subscriptions: the lifecycle views ───────────────────────────────
-- /admin/subscriptions filters by status and orders by period end, which is
-- "what expires next" — a question the console could not ask at all.
CREATE INDEX IF NOT EXISTS subscriptions_status_period_idx
  ON subscriptions (status, current_period_end DESC);

-- ── 6. Trials: redemptions per code ────────────────────────────────────
CREATE INDEX IF NOT EXISTS trial_redemptions_code_idx
  ON trial_redemptions (trial_code_id, redeemed_at DESC);

-- ── 7. Devices: one org's machines, newest first ────────────────────────
-- device_codes is indexed by status and expiry because that is what the
-- DEVICE flow polls. The console asks the opposite question — "this org's
-- machines" — which neither index answers.
CREATE INDEX IF NOT EXISTS device_codes_org_created_idx
  ON device_codes (organization_id, created_at DESC);

-- ── 8. Login lockouts: who is currently locked ─────────────────────────
-- auth_login_attempts is keyed by the bucket string, so an exact lookup
-- ('id:<email>') is already fast. This serves the LIST on /admin/system,
-- and the partial predicate keeps it to the handful of rows that matter.
CREATE INDEX IF NOT EXISTS auth_login_attempts_locked_idx
  ON auth_login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;
