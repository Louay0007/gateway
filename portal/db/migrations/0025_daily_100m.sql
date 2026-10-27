-- ══════════════════════════════════════════════════════════════
--  0025_daily_100m.sql — daily 100M blended-token budgets (Tunis day).
--
--  Replaces the monthly token wall with a DAILY wall:
--    Starter: fast 100M + smart 100M per Tunis calendar day
--    Pro:     smart 100M + frontier 100M per Tunis calendar day
--    Trial:   fast 100M + smart 100M per Tunis calendar day
--
--  The window itself lives in code (lib/entitlements/quota.ts
--  tunisDayWindow): Africa/Tunis is UTC+1 year-round, no DST, so a Tunis
--  day is 23:00Z → 23:00Z. The ledger keeps every row; enforcement just
--  sums a different slice.
--
--  GRANDFATHERING. Existing live paid subscriptions (active/past_due)
--  stay on their monthly window until their next renewal: the new
--  `subscriptions.daily_quota` flag is FALSE for them, TRUE for
--  everything new. Renewal (applyCallback subscription.activated) and
--  plan changes flip it to TRUE. Trials flip immediately (short-lived).
--
--  NON-TOKEN CONTROLS. rpm/tpm/concurrency columns are kept (display +
--  rollback safety) but nothing live pushes them to the gateway anymore —
--  the allowlist (tokens) is the only request-blocking control. The
--  upstream $10k team/key budget stays as a catastrophic backstop.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

-- ── 1. daily_quota flag on subscriptions ──────────────────────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS daily_quota boolean NOT NULL DEFAULT TRUE;

-- Grandfather live paid rows onto the monthly window until renewal.
UPDATE subscriptions
   SET daily_quota = FALSE
 WHERE status IN ('active', 'past_due', 'paused');

-- Trials are short-lived: flip them to daily immediately.
UPDATE subscriptions
   SET daily_quota = TRUE
 WHERE status = 'trialing';

-- ── 2. Daily 100M budgets ─────────────────────────────────────────────
-- Starter: fast 100M + smart 100M per day.
UPDATE plans SET
  token_limits = '{"fast": 100000000, "smart": 100000000}'::jsonb,
  updated_at = now()
WHERE code = 'starter';

-- Pro: smart 100M + frontier 100M per day (fast is Starter-only).
UPDATE plans SET
  token_limits = '{"smart": 100000000, "frontier": 100000000}'::jsonb,
  updated_at = now()
WHERE code = 'pro';

-- Trial (hidden plan): fast 100M + smart 100M per day.
UPDATE plans SET
  token_limits = '{"fast": 100000000, "smart": 100000000}'::jsonb,
  updated_at = now()
WHERE code = 'trial';

-- Trial code default carries the same daily budgets.
UPDATE trial_codes SET
  token_limits = '{"fast": 100000000, "smart": 100000000}'::jsonb
WHERE code = 'ZAINO-FREE-OCT26';

-- ── 3. quota_cadence marker on plans (display/documentation) ──────────
-- Enforcement reads subscriptions.daily_quota, not this column. It exists
-- so the admin surface and future tooling can tell a daily plan from a
-- legacy monthly one at a glance.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS quota_cadence text NOT NULL DEFAULT 'daily';

UPDATE plans SET quota_cadence = 'daily' WHERE code IN ('starter', 'pro', 'trial');

-- ── Force cached entitlements due (same mechanism as 0010/0019/0022) ──
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── Guard: every served alias on a shipped plan has a 100M daily budget ─
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || ':' || m)
    INTO bad
    FROM plans p, unnest(p.models) AS m
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND COALESCE((p.token_limits ->> m)::bigint, 0) <> 100000000;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plans missing daily 100M token_limits for served aliases: %', bad;
  END IF;
END $$;
