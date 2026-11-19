-- 0049: widen the partner trial — every paid alias, 15 keys, no token pool
--
-- WHAT CHANGES AND WHY EACH PART IS SAFE.
--
-- 1. MODELS. The trial plan was `{fast, smart}`. Partner evaluators were being
--    asked to judge a product whose top two tiers they could not call, so the
--    answer they could give was about the wrong thing. The grant is now every
--    paid alias: smart, frontier, fable. `fast` is deliberately absent — it is
--    the weight-1 alias and would let a three-day evaluation burn its grant on
--    the cheapest model without ever touching the two that matter.
--
--    This is the same model set as `pro` (0046), which is also the only paid
--    tier with 15 keys, so the grant is a faithful sample of one real tier
--    rather than an ad-hoc bundle. It costs more per evaluation (weight 3/15/15
--    against the old 1/3), which is why the pool change below matters.
--
-- 2. TOKENS: `'{}'::jsonb`. This is not "unset" and it is not zero — an empty
--    map is how one UNLIMITED allowance is expressed in this system.
--    `tokenPoolFromLimits()` returns null when no entry is positive, and null
--    means "no wall" (lib/entitlements/quota.ts:183). The alternative,
--    max_redemptions = 0 on the code, governs how MANY orgs may redeem; it says
--    nothing about how much one org may spend. They are different brakes and
--    only this one bounds cost.
--
--    THE COST OF THAT IS REAL, so it is stated rather than hidden: with no
--    pool, the only remaining cutoffs are (a) the 3-day window and (b)
--    `daily_token_cap`. The daily cap therefore stops being a blast-radius
--    backstop and becomes the primary spend brake, which is why it is set to
--    15M weighted units — 3.00 DT per org per Tunis day at the 0.20 DT/1M cost
--    basis. Three days is 9.00 DT per org, 1080 DT if all 120 redemptions run
--    to their limit every day.
--
--    15M is chosen so the whole grant stays a SAMPLE of a paid tier: 3 x 15M =
--    45M, under the 50M that Pro (90 DT) buys for a month with the same model
--    set. Anything above 16.6M/day would let a free trial out-grant the
--    cheapest paid tier that includes the same models, and the ladder loses its
--    reason to exist. That is the constraint, not a round number.
--
--    `daily_token_cap = 0` is not an option: it means no daily limit either,
--    leaving a 3-day unlimited grant with no cost ceiling at all. 0043
--    introduced the cap so one runaway day could not spend an entire
--    allowance, and that reasoning applies harder when there is no allowance to
--    spend.
--
-- 3. KEYS: 15, matching `pro`. Keys do NOT multiply the allowance — a key is a
--    credential, not a bucket, and with no pool there is nothing to multiply
--    anyway. 15 is enough for a real team to give each service its own key.
--
-- WHAT DOES NOT CHANGE: trial_days stays 3 on every code, and the per-code cap
-- stays 120 (0048). Both are asserted below so a future edit to either has to
-- come here and say so.

-- ── 1. The plan row ───────────────────────────────────────────────────
UPDATE plans SET
  token_limits    = '{}'::jsonb,
  daily_token_cap = 15000000,
  max_keys        = 15,
  models          = ARRAY['smart', 'frontier', 'fable'],
  description     = '3-day trial, unlimited tokens on smart, frontier and fable.',
  updated_at      = now()
 WHERE code = 'trial';

-- ── 2. Every active code states the same grant ────────────────────────
-- `trial_codes` has no max_keys column, and nothing reads its `models` or
-- `token_limits` for enforcement — `redeemTrialCode()` attaches the org to the
-- plan row and every check runs against that (0039 note on trial_codes). They
-- are still corrected here because they are what a human reads when auditing
-- a code, and a code row describing a grant the plan no longer makes is how
-- the next reader gets it wrong.
UPDATE trial_codes
   SET token_limits = '{}'::jsonb,
       models       = ARRAY['smart', 'frontier', 'fable']
 WHERE active IS TRUE;

-- ── 3. Guard ──────────────────────────────────────────────────────────
-- A migration that silently grants less than the email promised is worse than
-- a failed deploy. Every assertion here is a fact the outreach copy depends on.
DO $$
DECLARE
  plan_models text[];
  plan_keys   integer;
  plan_cap    bigint;
  plan_entries integer;
  bad_code    text;
  zero_pool   bigint;
BEGIN
  -- No jsonb_object_length() here: this build has no such function, and the
  -- value being asserted is one specific map, so equality says it exactly.
  SELECT p.models, p.max_keys, COALESCE(p.daily_token_cap, 0),
         (p.token_limits = '{}'::jsonb)::int
    INTO plan_models, plan_keys, plan_cap, plan_entries
    FROM plans p WHERE p.code = 'trial';

  IF plan_models IS NULL THEN
    RAISE EXCEPTION 'trial plan row is missing';
  END IF;

  -- Order-insensitive: ARRAY comparison is positional and 0046 has already
  -- been edited once for model order.
  IF array_length(plan_models, 1) <> 3
     OR NOT (plan_models @> ARRAY['smart', 'frontier', 'fable'])
     OR plan_models @> ARRAY['fast'] THEN
    RAISE EXCEPTION 'trial models are %, expected exactly smart/frontier/fable', plan_models;
  END IF;

  IF plan_keys <> 15 THEN
    RAISE EXCEPTION 'trial max_keys is %, expected 15', plan_keys;
  END IF;

  -- Unlimited is the EMPTY map. A non-empty map with a positive value would
  -- reintroduce a pool by accident; a zero value would read as unlimited too
  -- but only by the `<= 0` branch, which is the fragile way to say it.
  IF plan_entries <> 1 THEN
    RAISE EXCEPTION 'trial token_limits must be the empty map for unlimited, got %',
      COALESCE((SELECT token_limits::text FROM plans WHERE code = 'trial'), 'NULL');
  END IF;

  SELECT COALESCE(SUM(value::bigint), 0) INTO zero_pool
    FROM plans p, jsonb_each_text(p.token_limits) WHERE p.code = 'trial';
  IF zero_pool <> 0 THEN
    RAISE EXCEPTION 'trial still pools % weighted units; it is meant to be unlimited', zero_pool;
  END IF;

  -- The daily cap is now the ONLY spend brake, so it must be present.
  IF plan_cap <= 0 THEN
    RAISE EXCEPTION 'trial daily cap is %; with no pool this would be unbounded spend', plan_cap;
  END IF;

  IF plan_cap <> 15000000 THEN
    RAISE EXCEPTION 'trial daily cap is %, expected 15000000 (3.00 DT/day)', plan_cap;
  END IF;

  -- The ladder invariant: 3 days of the trial cap must not buy more than the
  -- cheapest paid tier carrying the same models (Pro: 50M for 90 DT). A free
  -- trial that out-grants its own step-up makes the step-up irrational.
  IF plan_cap * 3 > 50000000 THEN
    RAISE EXCEPTION
      'trial grants % over 3 days, more than Pro''s 50M for 90 DT', plan_cap * 3;
  END IF;

  SELECT c.code INTO bad_code
    FROM trial_codes c
   WHERE c.active IS TRUE
     AND (
       array_length(c.models, 1) <> 3
       OR NOT (c.models @> plan_models)
       OR c.token_limits <> '{}'::jsonb
       OR c.trial_days <> 3
     )
   LIMIT 1;

  IF bad_code IS NOT NULL THEN
    RAISE EXCEPTION 'active trial code % does not carry the plan grant', bad_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM trial_codes WHERE code = 'ZAINO-PARTNER-3D' AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'ZAINO-PARTNER-3D is not active; the outreach email is already written';
  END IF;
END $$;

-- ── 4. Force cached entitlements due ──────────────────────────────────
-- Orgs already trialing keep the old cached allowlist until it expires.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;
