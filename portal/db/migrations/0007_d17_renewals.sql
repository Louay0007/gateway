-- ═══════════════════════════════════════════════════════════════════════
--  0007_d17_renewals.sql — renewals need more than one payment per subscription
--
--  Until now `payments_d17.subscription_id` was UNIQUE: one row per
--  subscription for its lifetime, with re-checkout resetting the same row.
--  That made the first purchase work and made renewals impossible — a
--  second payment would have to OVERWRITE the first, destroying the
--  history `GET /api/billing/payments` exists to show.
--
--  This migration turns `payments_d17` into a real per-period ledger:
--
--    1. Drop the UNIQUE on subscription_id, replace with an index that
--       supports "latest payment for this subscription" (the lookup every
--       customer and admin surface needs).
--    2. Add period_start / period_end: which subscription period this
--       payment pays for. Set on creation from the subscription's current
--       or next period, corrected to the actual period on approval.
--       Nullable for backward compat — pre-0007 rows predate periods.
--
--  FORWARD-ONLY (scripts/db-migrate.sh). There is no down: after the first
--  renewal, duplicate subscription_id rows exist and the constraint cannot
--  be restored. The only recovery is `make restore` from a backup.
-- ═══════════════════════════════════════════════════════════════════════

-- The inline UNIQUE became payments_d17_subscription_id_key. Drop it if
-- present; a database that never had it is already correct.
ALTER TABLE payments_d17
  DROP CONSTRAINT IF EXISTS payments_d17_subscription_id_key;

-- Latest-payment-for-subscription. Every customer surface (checkout page,
-- proof submission, history) and the admin queue orders by created_at
-- desc for one subscription; without this the lookup is a seq scan the
-- day an account has a year of renewals.
CREATE INDEX IF NOT EXISTS payments_d17_sub_created_idx
  ON payments_d17 (subscription_id, created_at DESC);

-- Open-payment lookup: begin() must reuse an open row rather than piling
-- up attempts (at most one open per subscription, or the history fills
-- with phantoms that expire into noise).
CREATE INDEX IF NOT EXISTS payments_d17_sub_status_idx
  ON payments_d17 (subscription_id, status);

-- At-most-one-open-payment, enforced in the DATABASE, not only in begin().
-- Two simultaneous checkouts both see no open row and both insert; without
-- this index that is two live payment rows for one period and two proof
-- submissions racing for one subscription. The partial predicate is
-- exactly begin()'s "open" set; paid/expired are terminal and excluded, so
-- renewals are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS payments_d17_one_open_idx
  ON payments_d17 (subscription_id)
  WHERE status IN ('pending_payment', 'proof_submitted', 'rejected');

-- Which subscription period this payment covers. Provisional at creation
-- (from the subscription's current or next period), corrected to the
-- actual rolled period on approval. NULL for pre-0007 rows.
ALTER TABLE payments_d17
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end   TIMESTAMPTZ;

-- The renewal reminder / grace job needs no new table, but it needs a
-- ledger row to claim. expire_subscriptions already owns the rollover, so
-- it absorbs the grace logic (past_due → unpaid) rather than adding a
-- sixth job that would need its own lock, schedule, and failure mode.
-- No job_runs change.
