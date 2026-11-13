-- ══════════════════════════════════════════════════════════════════════
--  0039_pool_totals.sql — the allowance is ONE pool; state the total once.
--
--  WHAT 0038 LEFT BEHIND. It fixed the unit (month, not day) but wrote the
--  budgets as a SPLIT per alias:
--
--    starter  {fast: 25M, smart: 25M}
--    pro      {smart: 16.67M, frontier: 16.67M, fable: 16.66M}
--    trial    {fast: 25M, smart: 25M}
--
--  Enforcement since 2a92499 reads the SUM of that map, so each of those is
--  already a shared 50M pool. The split is a lie in the data though: read
--  the admin editor or the table and it looks like a 25M cap on fast. That
--  is exactly the shape 0025 shipped, so the next person to touch this will
--  assume a cap and reintroduce one.
--
--  THIS MIGRATION states the total once, on a single alias key. Same sum,
--  same enforcement, no way to mistake it for a per-model limit:
--
--    starter  50M shared  -> {fast: 50000000}
--    pro      50M shared  -> {smart: 50000000}
--    trial     1M shared  -> {fast: 1000000}
--
--  THE TRIAL DROPS FROM 50M TO 1M. A free 3-day trial was granting the same
--  volume as a paid Starter month, ~10 DT of upstream cost per redemption.
--  1M is enough to evaluate the product (~0.20 DT) and cannot be farmed.
--
--  WHY THE KEY NAMES DIFFER (fast vs smart) IS COSMETIC. The pool is spent
--  on any alias the plan unlocks — the key is where the total is written,
--  not what it may be spent on. `plans.models` decides that.
--
--  CUSTOMER-FACING TRUTH AFTER THIS:
--    Starter 50 DT  50M shared across fast + smart
--    Pro     90 DT  50M shared across smart + frontier + fable
--                   (Pro differs by model class, 15 keys and 25 seats —
--                    deliberately NOT by token volume)
--
--  FORWARD-ONLY. 0038 is already applied on production and is historical
--  record; this supersedes it without editing it. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. The totals ─────────────────────────────────────────────────────
UPDATE plans SET
  token_limits = '{"fast": 50000000}'::jsonb,
  updated_at   = now()
WHERE code = 'starter';

UPDATE plans SET
  token_limits = '{"smart": 50000000}'::jsonb,
  updated_at   = now()
WHERE code = 'pro';

UPDATE plans SET
  token_limits = '{"fast": 1000000}'::jsonb,
  updated_at   = now()
WHERE code = 'trial';

-- ── 2. Keep the code row aligned with the plan ────────────────────────
-- trial_codes.token_limits is NOT read for enforcement (redemption attaches
-- the org to the hidden `trial` PLAN row), but leaving 50M there would make
-- the two sources contradict each other on the next campaign.
UPDATE trial_codes
   SET token_limits = '{"fast": 1000000}'::jsonb
 WHERE COALESCE(token_limits, '{}'::jsonb) <> '{"fast": 1000000}'::jsonb;

-- ── 3. Force the cached entitlement due ───────────────────────────────
-- Same mechanism as 0010/0019/0025/0035/0038: planForOrg() reads the cached
-- row first, so without this the new budgets do not reach the gateway until
-- something else changes. NOTE: this only marks them stale — the sync itself
-- must be run (or triggered by a billing event) before the gateway sees it.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── 4. Guards ─────────────────────────────────────────────────────────
-- A migration that silently leaves the wrong ceiling is worse than one that
-- refuses to run, so each invariant raises.

DO $$
DECLARE
  got bigint;
BEGIN
  SELECT COALESCE(SUM(value::bigint), 0) INTO got
    FROM plans p, jsonb_each_text(p.token_limits)
   WHERE p.code = 'starter';
  IF got <> 50000000 THEN
    RAISE EXCEPTION '0039: starter pool is %, expected 50000000', got;
  END IF;

  SELECT COALESCE(SUM(value::bigint), 0) INTO got
    FROM plans p, jsonb_each_text(p.token_limits)
   WHERE p.code = 'pro';
  IF got <> 50000000 THEN
    RAISE EXCEPTION '0039: pro pool is %, expected 50000000', got;
  END IF;

  SELECT COALESCE(SUM(value::bigint), 0) INTO got
    FROM plans p, jsonb_each_text(p.token_limits)
   WHERE p.code = 'trial';
  IF got <> 1000000 THEN
    RAISE EXCEPTION '0039: trial pool is %, expected 1000000', got;
  END IF;
END $$;

-- No shipped plan may exceed 50M, and Pro must not exceed Starter — the
-- inversion 0038 documented must not sneak back in through the data.
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
   WHERE p.code IN ('starter', 'pro')
     AND totals.sum_tokens > 50000000;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0039: plan pool exceeds the 50M ceiling: %', array_to_string(bad, ', ');
  END IF;
END $$;

-- Every alias a shipped plan serves must be covered by a positive total,
-- or the wall fails open and the plan is unlimited.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code) INTO bad
    FROM plans p
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(value::bigint), 0) AS sum_tokens
        FROM jsonb_each_text(p.token_limits)
    ) AS totals
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND totals.sum_tokens <= 0;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0039: plan with no token pool (would be unlimited): %',
      array_to_string(bad, ', ');
  END IF;
END $$;
