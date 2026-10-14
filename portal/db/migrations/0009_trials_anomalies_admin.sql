-- ═══════════════════════════════════════════════════════════════════════
--  0009_trials_anomalies_admin.sql — the three deferred dev features
--
--  Phase E's remaining dev work, now in scope:
--
--    1. TRIALS. The machinery (plans.trial_days, subscriptions.trial_end,
--       sub_status 'trialing', STATUS_EFFECT.trialing='full') shipped in
--       0003, but every plan carried trial_days=0, so no code path ever
--       set them and the state was dead. Starter now offers a 7-day trial.
--
--    2. ANOMALY ALERTS. `detect_anomalies` was seeded in 0001 and deleted
--       in 0003 as deferred; the money-risk signals it names are real now
--       (a limiter miss, a mule phone paying for many orgs, a rejected-
--       proof burst), so the job ledger row comes back.
--
--    3. ADMIN CONSOLE. Staff-recorded credit notes / refunds and the
--       org-status actions (suspend / reactivate) need a home. D17 has no
--       refund API, so a refund is a manual transfer ops makes by hand;
--       `credit_notes` is the record of it.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Trials: Starter only, 7 days ───────────────────────────────────
-- Pro deliberately keeps trial_days = 0. A trial runs at the plan's FULL
-- included spend (STATUS_EFFECT.trialing = 'full'), and Pro's included
-- spend resolves to ~$144 of upstream budget — too large a free grant to
-- switch on without an explicit business decision. Starter's ~$15 is a
-- sane "try it". A plan with trial_days = 0 simply offers no trial.
UPDATE plans
   SET trial_days = 7,
       updated_at = now()
 WHERE code = 'starter';

-- ── 2. Job ledger rows: the two restored jobs ─────────────────────────
-- A job is active only when registered in scripts/jobs.ts AND present in
-- `job_runs` (the runner claims its row before doing anything).
INSERT INTO job_runs (name) VALUES
  ('expire_trials'),
  ('detect_anomalies')
ON CONFLICT (name) DO NOTHING;

-- ── 3. Credit notes ───────────────────────────────────────────────────
-- Append-only, like audit_log. One row is one manual money movement, tied
-- to the org it concerns so the next reader can reconstruct why.
CREATE TABLE IF NOT EXISTS credit_notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Signed: negative = we refunded the customer, positive = goodwill
  -- credit applied against their next bill. Zero is meaningless.
  amount_cents     INTEGER     NOT NULL CHECK (amount_cents <> 0),
  currency         TEXT        NOT NULL DEFAULT 'TND',
  reason           TEXT        NOT NULL,
  -- staff_users.id of the operator who recorded it. Never a customer id.
  created_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_notes_org_idx
  ON credit_notes (organization_id, created_at DESC);

-- ── 4. Suspension is enforced by sync, not just the status column ─────
-- `syncOrganizationEntitlements` now reads organizations.status and cuts
-- a non-active org. The reconciler previously selected only active orgs,
-- which meant a suspended org's cut was never re-asserted after drift.
-- Widen the index the reconciler filters on so suspended orgs are cheap
-- to include.
CREATE INDEX IF NOT EXISTS organizations_active_suspended_idx
  ON organizations (status) WHERE status IN ('active', 'suspended');
