-- ══════════════════════════════════════════════════════════════════════
--  0046_plan_ladder.sql — six tiers, each selling a different job.
--
--  WHY. Two plans cannot serve three markets. Starter and Pro both carry a
--  50M pool, so the only thing between them is which models they unlock;
--  a company that wants a bigger pool has to buy several Pro rows by hand,
--  and a developer who finds 50 DT too steep has nothing below it.
--  Meanwhile Promptix sells the same product from 5 TND on a top-up, so
--  Zaino loses the casual buyer purely on entry price.
--
--  THE LADDER (founder's decision, PRICING-MODEL-2026-11.md §3):
--
--    code      DT/mo  pool   cost   margin  models                    keys
--    trial       0    1M     0.20     —     fast, smart                 1
--    solo       39    35M    7.00   82.1%   fast, smart                 2
--    starter    50    50M   10.00   80.0%   fast, smart                 3
--    pro        90    50M   10.00   88.9%   smart, frontier, fable     15
--    team      250    150M  30.00   88.0%   smart, frontier, fable     30
--    business  500    400M  80.00   84.0%   smart, frontier, fable    100
--
--  ⚠ NO SEATS. 0044_remove_seats.sql retired per-seat pricing because
--  `organization_members` has exactly one writer (signup provisioning,
--  the owner row): there is no invite route, no member list, no member UI
--  and no seat check on any request path. Billing for a second seat would
--  take money for people who cannot hold a key. Team and Business are
--  therefore sold as bigger pools and more keys on ONE invoice, not as a
--  bundle of people — the earlier draft of this ladder priced seats and
--  was wrong to. The upgrade argument between Pro and Team is 3× the pool
--  (and 7× the keys) for 160 DT more, which is the argument that survives.
--
--  THE TRIAL STAYS AT 1M. 0039 dropped it from 50M to 1M because a free
--  50M grant was ~10 DT of upstream cost per redemption. The pricing model
--  proposed 10M to make the 7.74× advantage visible on day one; that was
--  declined. The row is touched here only to pin it explicitly so a later
--  reader does not think the ladder forgot it. 0045 owns the trial CODE;
--  this file only states the plan row it redeems into.
--
--  POOLS ARE WEIGHTED UNITS, NOT RAW TOKENS (0038/0039). A 400M Business
--  pool is 400M of blended units: 400M smart tokens, or 1.2B fast, or 80M
--  frontier. Writing it as one key on one alias is deliberate — a split
--  map reads like a per-model ceiling and 0025 proved what that costs.
--
--  ⚠ THE CARD RAIL DOES NOT SELL THESE YET. 0040 maps Starter and Pro to
--  Dodo products. Solo, Team and Business have price_cents for display but
--  NO provider_price_id, because those products do not exist in the Dodo
--  dashboard. Dodo checkout for them fails with a clear error naming the
--  plan; D17 — the live Tunisian rail — works. Creating the products and
--  pasting their ids is the follow-up, and it must be a separate migration
--  so switching a deployment to charging real cards is never a side effect
--  of a catalog change.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. The two new entry tiers ────────────────────────────────────────
-- Solo sits BELOW Starter: less pool, fewer keys, same two models. It must
-- be strictly worse than Starter on volume and price or it cannibalises
-- it (the pricing model's fairness rule #2).

INSERT INTO plans (
  code, name, description, public, sort_order,
  price_cents, price_tnd_millimes, interval,
  included_spend_cents, overage_markup_bps, hard_cap_cents,
  rpm_limit, tpm_limit, max_concurrent_requests,
  max_keys, rate_multiplier_bps,
  models, trial_days, features, token_limits, daily_token_cap
) VALUES (
  'solo',
  'Solo',
  'For one developer who wants the cheapest way onto the strong models.',
  TRUE, 1,
  1300, 39000, 'month',
  0, 3000, NULL,
  60, 200000, 5,
  2, 13000,
  ARRAY['fast', 'smart'], 0,
  '{"history_days":90,"exports":false}'::jsonb,
  '{"fast": 35000000}'::jsonb,
  3500000
)
ON CONFLICT (code) DO NOTHING;

-- ── 2. The company tiers ──────────────────────────────────────────────
-- `business` existed in 0001 and was deleted in 0003 with `free`. This
-- re-creates it with entirely different numbers — the 0003 row was a
-- $499 seat-of-pants placeholder that never shipped.

INSERT INTO plans (
  code, name, description, public, sort_order,
  price_cents, price_tnd_millimes, interval,
  included_spend_cents, overage_markup_bps, hard_cap_cents,
  rpm_limit, tpm_limit, max_concurrent_requests,
  max_keys, rate_multiplier_bps,
  models, trial_days, features, token_limits, daily_token_cap
) VALUES (
  'team',
  'Team',
  'Three times Pro''s pool and thirty keys, on one invoice.',
  TRUE, 4,
  8000, 250000, 'month',
  0, 3000, NULL,
  600, 4000000, 40,
  30, 13000,
  ARRAY['smart', 'frontier', 'fable'], 0,
  '{"history_days":365,"exports":true,"priority_support":true}'::jsonb,
  '{"smart": 150000000}'::jsonb,
  15000000
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO plans (
  code, name, description, public, sort_order,
  price_cents, price_tnd_millimes, interval,
  included_spend_cents, overage_markup_bps, hard_cap_cents,
  rpm_limit, tpm_limit, max_concurrent_requests,
  max_keys, rate_multiplier_bps,
  models, trial_days, features, token_limits, daily_token_cap
) VALUES (
  'business',
  'Business',
  'Company-wide rollout: 400M blended tokens, 100 keys, one finance line.',
  TRUE, 5,
  16000, 500000, 'month',
  0, 3000, NULL,
  1200, 8000000, 80,
  100, 13000,
  ARRAY['smart', 'frontier', 'fable'], 0,
  '{"history_days":730,"exports":true,"sso":true,"audit_api":true,"priority_support":true}'::jsonb,
  '{"smart": 400000000}'::jsonb,
  40000000
)
ON CONFLICT (code) DO NOTHING;

-- ── 3. Re-order and re-state the existing tiers ───────────────────────
-- sort_order is what the pricing cards and the paywall follow, so the
-- ladder has to be numbered here or a 39 DT plan renders after a 500 DT
-- one. Starter keeps its price and pool; only its position is restated,
-- so this block is idempotent by construction.

UPDATE plans SET sort_order = 2, name = 'Starter', updated_at = now()
 WHERE code = 'starter';

UPDATE plans SET sort_order = 3, name = 'Pro', max_keys = 15, updated_at = now()
 WHERE code = 'pro';

-- The trial is deliberately NOT re-priced or re-pooled (see the header).
-- Restating it makes the intent legible and guards against a future edit
-- that "fixes" the ladder by silently dropping the trial back to 50M.
UPDATE plans SET
  token_limits    = '{"fast": 1000000}'::jsonb,
  daily_token_cap = 250000,
  max_keys        = 1,
  updated_at      = now()
 WHERE code = 'trial';

-- The hidden trial plan's code row carries its own copy (0039). Keep it in
-- step so a campaign cannot contradict the plan row it redeems into.
UPDATE trial_codes
   SET token_limits = '{"fast": 1000000}'::jsonb
 WHERE COALESCE(token_limits, '{}'::jsonb) <> '{"fast": 1000000}'::jsonb;

-- ── 4. Every public plan must state a pool and a dinar price ──────────
-- A public row with no token_limits is enforced as UNLIMITED by
-- lib/entitlements/quota.ts (a missing entry means no entry, and a missing
-- total means no wall). That is the most expensive possible failure in
-- this system, so it is checked in the data rather than in a code path
-- that could be skipped.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(code) INTO bad
    FROM plans p
   WHERE p.public = TRUE
     AND p.code <> 'trial'
     AND (
       COALESCE((SELECT SUM(value::bigint) FROM jsonb_each_text(p.token_limits)), 0) = 0
       OR p.price_tnd_millimes IS NULL
       OR p.price_tnd_millimes = 0
     );

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0046: public plan(s) with no pool or no dinar price: %',
      array_to_string(bad, ', ');
  END IF;
END $$;

-- ── 5. The ladder, in the order it is sold ────────────────────────────
-- Cheapest first, and every step must raise volume per dinar, keys per
-- dinar, or model class — otherwise it is not an upgrade, it is a trap.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(expected.code || '=' ||
                   COALESCE((SELECT SUM(value::bigint)
                               FROM jsonb_each_text(p.token_limits)), 0) ||
                   ' (want ' || expected.pool || ')')
    INTO bad
    FROM (VALUES
      ('trial',     1000000::bigint),
      ('solo',     35000000::bigint),
      ('starter',  50000000::bigint),
      ('pro',      50000000::bigint),
      ('team',    150000000::bigint),
      ('business',400000000::bigint)
    ) AS expected(code, pool)
    JOIN plans p ON p.code = expected.code
   WHERE COALESCE((SELECT SUM(value::bigint)
                     FROM jsonb_each_text(p.token_limits)), 0) <> expected.pool;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0046: wrong pool size(s): %', array_to_string(bad, ', ');
  END IF;

  -- A plan missing entirely is not "wrong", it is absent. Catch that too,
  -- because ON CONFLICT DO NOTHING above would hide a failed insert.
  SELECT array_agg(expected.code) INTO bad
    FROM (VALUES ('solo'), ('starter'), ('pro'), ('team'), ('business'), ('trial'))
      AS expected(code)
   WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.code = expected.code);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0046: plan row(s) missing after insert: %', array_to_string(bad, ', ');
  END IF;
END $$;

-- Cheap must mean smaller. Solo above Starter, or Team above Business,
-- would make the ladder a circle and the buyer would notice.
DO $$
BEGIN
  IF (SELECT price_tnd_millimes FROM plans WHERE code = 'solo')
     >= (SELECT price_tnd_millimes FROM plans WHERE code = 'starter') THEN
    RAISE EXCEPTION '0046: Solo must cost less than Starter';
  END IF;
  IF (SELECT SUM(value::bigint) FROM plans p, jsonb_each_text(p.token_limits)
       WHERE p.code = 'solo')
     >= (SELECT SUM(value::bigint) FROM plans p, jsonb_each_text(p.token_limits)
          WHERE p.code = 'starter') THEN
    RAISE EXCEPTION '0046: Solo must deliver less than Starter';
  END IF;
  IF (SELECT price_tnd_millimes FROM plans WHERE code = 'team')
     >= (SELECT price_tnd_millimes FROM plans WHERE code = 'business') THEN
    RAISE EXCEPTION '0046: Team must cost less than Business';
  END IF;
END $$;

-- ── 6. Force every cached entitlement due ─────────────────────────────
-- planForOrg() reads the cached row first (same mechanism as
-- 0010/0019/0025/0035/0038/0039). Without this a plan whose ceiling moved
-- keeps its old wall until something else touches the org. This only marks
-- them stale; the sync itself still has to run.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;
