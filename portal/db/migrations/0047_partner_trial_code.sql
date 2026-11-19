-- 0047: Partner outreach trial code
--
-- WHY THIS IS A MIGRATION AND NOT A SCRIPT. A trial code cannot carry its own
-- grant. `redeemTrialCode()` attaches the org to the ONE hidden `trial` PLAN
-- row and the wall reads that row's `token_limits`, `daily_token_cap` and
-- `max_keys`; `trial_codes.token_limits` is not read for enforcement (schema
-- note on trial_codes, 0039). So widening the grant for partner outreach means
-- changing the plan row, which every redeemer shares — `ZAINO-LAUNCH-3M`
-- included. Stating that here rather than in a one-off script keeps the two
-- sources of truth from diverging the next time someone re-reads the ladder.
--
-- The grant moves from 1M to 4M weighted units (0.80 DT per redemption at the
-- 0.20 DT/1M cost basis). 4M is sized between what a real three-day
-- integration burns and Starter's 50M: large enough that an evaluator never
-- hits the wall mid-test, small enough that the free code stays a sample of
-- the 49 DT entry tier rather than a substitute for it.
--
-- Widening max_keys from 1 to 2 costs nothing: `tokenPoolFromLimits` is one
-- pool per subscription, so a second key draws on the same 4M rather than
-- granting a second allowance. Two keys is the real evaluation shape — one
-- for the sandbox, one for a staging deploy — and it matches Solo, so the
-- grant is honest about what the paid step up buys.

-- ── 1. The plan row: one shared pool, two keys, room for a real test ───
-- The daily cap is 2M, not 1.33M, so it never acts as a second wall: 2M x 3
-- days exceeds the 4M pool, and the pool is what a normal evaluator hits. The
-- cap exists only to stop one runaway day spending the whole grant.
UPDATE plans SET
  token_limits    = '{"fast": 4000000}'::jsonb,
  daily_token_cap = 2000000,
  max_keys        = 2,
  description     = '3-day trial, 4M shared tokens on fast and smart.',
  updated_at      = now()
 WHERE code = 'trial';

-- ── 2. Every redeeming code states the same pool ──────────────────────
-- Not used for enforcement, only for legibility at the code row. Kept equal
-- to the plan so a future reader cannot infer a per-code override that does
-- not exist.
UPDATE trial_codes
   SET token_limits = '{"fast": 4000000}'::jsonb
 WHERE active IS TRUE;

-- ── 3. The partner code ───────────────────────────────────────────────
-- Capped at 60 rather than unlimited: `max_redemptions = 0` means a leak onto
-- a Telegram group is unbounded, and a redemption cannot be undone.
INSERT INTO trial_codes (
  code, created_by, max_redemptions, models, token_limits, trial_days,
  valid_from, valid_until, expires_at, active
) VALUES (
  'ZAINO-PARTNER-3D',
  'louay',
  60,
  ARRAY['fast', 'smart'],
  '{"fast": 4000000}'::jsonb,
  3,
  '2026-11-19T00:00:00+01:00',
  '2026-12-31T23:59:59+01:00',
  '2026-12-31T23:59:59+01:00',
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  active          = TRUE,
  max_redemptions = EXCLUDED.max_redemptions,
  token_limits    = EXCLUDED.token_limits,
  valid_from      = EXCLUDED.valid_from,
  valid_until     = EXCLUDED.valid_until,
  expires_at      = EXCLUDED.expires_at;

-- ── 4. Guard: the plan and every active code must agree ───────────────
-- A redemption that silently gets less than the email promised is worse than
-- a failed deploy, so this fails the migration instead of warning.
DO $$
DECLARE
  plan_pool bigint;
  plan_keys integer;
  plan_cap  bigint;
  bad_code  text;
BEGIN
  SELECT COALESCE(SUM(value::bigint), 0), max_keys, COALESCE(daily_token_cap, 0)
    INTO plan_pool, plan_keys, plan_cap
    FROM plans p, jsonb_each_text(p.token_limits)
   WHERE p.code = 'trial'
   GROUP BY p.max_keys, p.daily_token_cap;

  IF plan_pool <> 4000000 THEN
    RAISE EXCEPTION 'trial pool is % weighted units, expected 4000000', plan_pool;
  END IF;

  IF plan_keys <> 2 THEN
    RAISE EXCEPTION 'trial max_keys is %, expected 2', plan_keys;
  END IF;

  -- The daily cap must not bind before the pool: a 3-day trial with a 1M/day
  -- cap can still spend 3M of the 4M, so the cap is a blast-radius limit and
  -- not a second wall. Refuse a cap that makes the pool unreachable.
  IF plan_cap * 3 < plan_pool THEN
    RAISE EXCEPTION
      'trial daily cap % x 3 cannot reach the % pool over a 3-day trial',
      plan_cap, plan_pool;
  END IF;

  SELECT c.code INTO bad_code
    FROM trial_codes c
   WHERE c.active IS TRUE
     AND COALESCE((SELECT SUM(value::bigint) FROM jsonb_each_text(c.token_limits)), 0)
         <> plan_pool
   LIMIT 1;

  IF bad_code IS NOT NULL THEN
    RAISE EXCEPTION 'active trial code % states a pool different from the plan', bad_code;
  END IF;
END $$;

-- ── 5. Force cached entitlements due ──────────────────────────────────
-- entitlements.sync caches per org; without this a trialing org keeps the old
-- 1M wall until its cache expires. Same mechanism as 0010/0019/0022.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;
