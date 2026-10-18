-- ════════════════════════════════════════════════════════════════════════
--  0015_admin_console.sql — the read paths the ops console was missing
--
--  The console in 0009 could WRITE credit notes, suspend an org and
--  approve a payment, but it could not READ any of it back: no index
--  served "recent activity", "this org's usage", or "what changed", so
--  every one of those screens would have been a sequential scan over
--  tables that only ever grow.
--
--  Two kinds of statement here, and the split matters:
--
--    1. INDEXES. Pure performance; the queries they serve are already
--       written and proven by `make verify-metering`. No behaviour change.
--
--    2. staff_users.created_by / revoked_at. Staff are currently
--       insert-only via scripts/create-accounts.ts, which means a
--       compromised staff account can be neither traced nor revoked
--       without a hand-written UPDATE. `requireStaff` does not read
--       these columns yet; 0015 only makes them exist so the revoke path
--       is a row that survives, not a DELETE that erases the evidence.
--       They are NULL for every existing row, which is correct: those
--       accounts predate the audit trail for their own creation.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Org list: newest first, and filtered by status ─────────────────
-- listAdminOrgs orders by created_at DESC and (once filters land) filters
-- on status. The existing index is on (status) alone, which serves the
-- filter but forces a sort over the whole table for the ordering.
CREATE INDEX IF NOT EXISTS organizations_created_idx
  ON organizations (created_at DESC);

-- ── 2. Org drill-down usage: this org, newest first ──────────────────
-- The customer-facing usage page uses (organization_id, billing_period);
-- the admin drill-down wants the same org ordered by wall-clock time, and
-- the collector appends continuously, so occurred_at DESC is the hot
-- path for "what did this account just do?".
CREATE INDEX IF NOT EXISTS usage_records_org_occurred_idx
  ON usage_records (organization_id, occurred_at DESC);

-- ── 3. Financials: the whole ledger by day ────────────────────────────
-- Revenue and margin are aggregates over cost_customer_usd /
-- cost_upstream_usd grouped by day. occurred_at alone does not cover a
-- filtered, grouped scan once the ledger is large.
CREATE INDEX IF NOT EXISTS usage_records_occurred_cost_idx
  ON usage_records (occurred_at, cost_customer_usd, cost_upstream_usd);

-- ── 4. Credit notes: global recent list ───────────────────────────────
-- The org-scoped index (0009) cannot serve "show me every credit note
-- recorded in the last 30 days", which is the accounting question the
-- orphaned listCreditNotes() exists to answer.
CREATE INDEX IF NOT EXISTS credit_notes_created_idx
  ON credit_notes (created_at DESC);

-- ── 5. Audit log: recent activity, unscoped ───────────────────────────
-- audit_log has (action, created_at) and (organization_id, created_at).
-- A cross-org "what changed recently" feed needs neither: it wants
-- created_at alone. This is the table that grows fastest — every key
-- create, every sync, every approval writes a row — so it is the one
-- where a sequential scan hurts most.
CREATE INDEX IF NOT EXISTS audit_log_created_idx
  ON audit_log (created_at DESC);

-- ── 6. Staff: who created this operator, and is it revoked ────────────
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Listing the staff roster filters out revoked accounts and orders by
-- name; without this it is a scan of a table that grows by invitation.
CREATE INDEX IF NOT EXISTS staff_users_active_idx
  ON staff_users (revoked_at, created_at DESC)
  WHERE revoked_at IS NULL;