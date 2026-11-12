-- ══════════════════════════════════════════════════════════════════════
--  0038_monthly_50m.sql — 50M blended tokens per MONTH, per plan.
--
--  WHY. Token cost is 100 DT per 500M tokens = 0.20 DT per 1M. The
--  0025/0029/0035 model granted 100M to EVERY alias EVERY DAY, which is
--  3B tokens per alias per 30-day month:
--
--    Starter (fast + smart)   6.0B tok/mo ->  1,200 DT cost vs  50 DT price
--    Pro (smart+frontier+fable) 9.0B tok/mo ->  1,800 DT cost vs  90 DT price
--
--  That is a 20–24x structural loss on every subscriber, and it happened
--  because 0025 replaced a monthly wall with a daily one while 0029 then
--  forced every row onto it. A DAILY cap is the wrong shape for a MONTHLY
--  token purchase: the only budget the customer can actually exhaust is
--  the one you paid for.
--
--  WHAT CHANGES.
--
--    plans.token_limits  becomes a MONTHLY total, split across the aliases
--                        the plan serves (NOT duplicated per alias — that
--                        is how the exposure multiplied in the first place):
--
--      starter  50M/mo total -> fast 25M + smart 25M
--      pro      50M/mo total -> smart 16,666,667 + frontier 16,666,667
--                              + fable 16,666,666
--      trial    50M/mo total -> fast 25M + smart 25M
--
--    subscriptions.daily_quota  becomes FALSE for every row, which routes
--                        usageWindowForSubscription() to the subscription
--                        PERIOD (or calendar month) instead of the Tunis
--                        day. That helper already existed for grandfathered
--                        rows (0025); this makes it the only path.
--
--  ECONOMICS AT 50M/MONTH (0.20 DT per 1M):
--
--    plan    price   cost if fully burned   margin   margin at 25% use
--    starter 50 DT   10.0 DT               80%      95%
--    pro     90 DT   10.0 DT               89%      97%
--
--  500M bought for 100 DT now serves 10 subscribers at FULL burn, or ~40
--  at realistic use.
--
--  ⚠ OPEN PRODUCT DECISION — Pro gets LESS per model than Starter.
--  Both plans cap at 50M TOTAL, so Pro's 50M splits three ways:
--
--    starter  fast 25M, smart 25M          -> 25M per model
--    pro      smart/frontier/fable ~16.7M  -> 16.7M per model
--
--  A Pro customer hits a per-alias wall SOONER than a Starter customer,
--  which is backwards for a plan costing 1.8x more. Pro also carries the
--  expensive aliases (frontier/fable list at 15x the fast rate). Two ways
--  out, both in this file's comments rather than applied:
--
--    (a) Pro = 50M PER ALIAS (150M total). Cost 30 DT vs 90 DT = 67%
--        worst-case margin, and every model gets the full 50M.
--    (b) Pro = 50M total but Starter drops to 30M, restoring the gap.
--
--  (a) is the recommendation: it is still a 67% floor, and it removes the
--  inversion. Applied only if the operator asks — this migration ships
--  exactly the 50M total that was specified.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Monthly token budgets, split per alias (50M total per plan) ─────
UPDATE plans SET
  token_limits = '{"fast": 25000000, "smart": 25000000}'::jsonb,
  updated_at   = now()
WHERE code = 'starter';

UPDATE plans SET
  token_limits = '{"smart": 16666667, "frontier": 16666667, "fable": 16666666}'::jsonb,
  updated_at   = now()
WHERE code = 'pro';

UPDATE plans SET
  token_limits = '{"fast": 25000000, "smart": 25000000}'::jsonb,
  updated_at   = now()
WHERE code = 'trial';

-- ── 2. Every subscription sums over its PERIOD, not the Tunis day ─────
-- This is the half of the fix that makes the numbers above mean anything.
-- A 50M budget summed over a DAY would be 50M/day = 1.5B/month.
UPDATE subscriptions
   SET daily_quota = FALSE;

-- New rows must not inherit 0025's TRUE default, or every signup after this
-- migration silently gets a daily window again.
ALTER TABLE subscriptions
  ALTER COLUMN daily_quota SET DEFAULT FALSE;

-- The display marker follows the real cadence (nothing reads it for
-- enforcement; subscriptions.daily_quota does).
UPDATE plans SET quota_cadence = 'monthly' WHERE quota_cadence = 'daily';

-- ── 3. The November trial code carries a MONTHLY total too ────────────
-- The trial runs 3 days, so its window (currentPeriodStart..trialEnd)
-- covers the whole trial and the 50M is a single 3-day allowance, not
-- 150M. Cost at full burn: 10 DT per redemption (was 120 DT).
UPDATE trial_codes SET
  token_limits = '{"fast": 25000000, "smart": 25000000}'::jsonb
WHERE code = 'ZAINO-FREE-NOV26';

-- Any other live code is brought in line so a future campaign cannot ship
-- a per-day budget by copying an old row.
UPDATE trial_codes SET
  token_limits = '{"fast": 25000000, "smart": 25000000}'::jsonb
WHERE COALESCE(token_limits, '{}'::jsonb) <> '{"fast": 25000000, "smart": 25000000}'::jsonb;

-- ── 4. Force cached entitlements due right now ────────────────────────
-- Same mechanism as 0010/0019/0025/0035: planForOrg() reads the cached
-- row first, so without this the new budgets do not reach the gateway
-- until the next sync tick.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── 5. Guard: no shipped plan may total more than 50M per month ───────
-- The whole point of this migration is the ceiling, so assert it. Sums the
-- per-alias entries — a plan that repeats 50M on three aliases fails here,
-- which is the exact mistake 0025 made.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || '=' || totals.sum_tokens) INTO bad
    FROM plans p
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(value::bigint), 0) AS sum_tokens
        FROM jsonb_each_text(p.token_limits)
    ) AS totals
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND totals.sum_tokens > 50000000;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0038: plan monthly token totals exceed 50M: %', array_to_string(bad, ', ');
  END IF;
END $$;

-- ── 6. Guard: no subscription may remain on the daily window ──────────
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM subscriptions WHERE daily_quota = TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION
      '0038: % subscription(s) still on the daily window — budgets would be per-day', n;
  END IF;
END $$;

-- ── 7. Guard: every shipped alias has a budget (fail-open is a hole) ──
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || ':' || m) INTO bad
    FROM plans p, unnest(p.models) AS m
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND COALESCE((p.token_limits ->> m)::bigint, 0) <= 0;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0038: served alias with no monthly token budget: %', array_to_string(bad, ', ');
  END IF;
END $$;
