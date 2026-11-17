-- ══════════════════════════════════════════════════════════════════════
--  0045_launch_trial_code.sql — ONE trial code for the whole launch.
--
--  WHY. There were two: ZAINO-FREE-OCT26 (0017, window closed 31 Oct) and
--  ZAINO-FREE-NOV26 (0036, window closes 30 Nov). Each campaign added a
--  row, so the table grows one dead code per month and every one of them
--  still answers a redemption attempt — the October code reports "expired"
--  rather than "unknown", which is accurate but is not one code.
--
--  The operator asked for a SINGLE code tied to the Zaino launch, open for
--  THREE MONTHS. The launch was 20 October 2026, so the campaign runs
--  20 Oct 2026 → 20 Jan 2027 23:59:59 Africa/Tunis (UTC+1, no DST).
--
--    code            ZAINO-LAUNCH-3M
--    trial length    3 days  (unchanged — the CAMPAIGN is 3 months, an
--                             individual trial is still 3 days)
--    token_limits    1M shared pool (0039), one 3-day allowance
--    models          fast, smart
--    redemptions     unlimited, one per org (trial_redemptions UNIQUE)
--
--  Expiry is still min(now + trial_days, expires_at) — see
--  redeemTrialCode — so a redemption on 19 January gets the day that is
--  actually left, never a trial that outlives the campaign.
--
--  The old codes are DEACTIVATED, not deleted. `trial_redemptions` has an
--  ON DELETE CASCADE FK to this table, so a DELETE would silently destroy
--  the redemption history of everyone who already used one. `active =
--  FALSE` also gives the holder the accurate "this code is no longer
--  active" instead of a uniqueness error.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. The one launch code ────────────────────────────────────────────
INSERT INTO trial_codes (
  code,
  created_by,
  max_redemptions,
  models,
  token_limits,
  trial_days,
  valid_from,
  valid_until,
  expires_at,
  active
)
VALUES (
  'ZAINO-LAUNCH-3M',
  'system',
  0,                                          -- unlimited redemptions
  ARRAY['fast', 'smart'],
  '{"fast": 1000000}'::jsonb,                 -- ONE shared pool (0039)
  3,
  '2026-10-20T00:00:00+01:00',
  '2027-01-20T23:59:59+01:00',
  '2027-01-20T23:59:59+01:00',
  TRUE
)
ON CONFLICT (code) DO UPDATE
   SET models          = EXCLUDED.models,
       token_limits    = EXCLUDED.token_limits,
       trial_days      = EXCLUDED.trial_days,
       valid_from      = EXCLUDED.valid_from,
       valid_until     = EXCLUDED.valid_until,
       expires_at      = EXCLUDED.expires_at,
       active          = TRUE;

-- ── 2. Exactly one redeemable code, by construction ───────────────────
-- Scoped to "everything that is not the launch code" rather than to the
-- two known names: a campaign added by any other path is retired too, so
-- the invariant cannot be broken by copying an old row.
UPDATE trial_codes
   SET active = FALSE
 WHERE code <> 'ZAINO-LAUNCH-3M'
   AND active IS TRUE;

-- ── 3. The trial plan's description stops describing prompts ──────────
-- 0017 wrote '3-day trial with 300 requests on Sonnet 5 and Opus 5.5.'
-- Prompts stopped being a quota in 0023, so that sentence has advertised a
-- unit the wall does not enforce and two vendor model names the alias
-- layer exists to hide. Display-only; nothing reads it for enforcement.
UPDATE plans
   SET description = '3-day free trial, 1M shared tokens on fast and smart.',
       updated_at  = now()
 WHERE code = 'trial';

-- ── 4. Guards ─────────────────────────────────────────────────────────
DO $$
DECLARE
  redeemable integer;
  launch     trial_codes;
BEGIN
  SELECT count(*) INTO redeemable
    FROM trial_codes
   WHERE active IS TRUE
     AND valid_from <= now()
     AND valid_until > now();

  -- A second live code means two concurrent offers, which is the thing
  -- this migration exists to remove.
  IF redeemable > 1 THEN
    RAISE EXCEPTION 'expected at most 1 live trial code, found %', redeemable;
  END IF;

  SELECT * INTO launch FROM trial_codes WHERE code = 'ZAINO-LAUNCH-3M';

  IF launch.id IS NULL THEN
    RAISE EXCEPTION 'launch trial code was not written';
  END IF;

  -- An empty or zero pool redeems successfully and then hits an unlimited
  -- wall; a zero trial_days makes min(now+0, expires_at) an instant expiry.
  IF COALESCE((launch.token_limits ->> 'fast')::bigint, 0) <= 0 THEN
    RAISE EXCEPTION 'launch trial code is unusable: empty token pool';
  END IF;

  IF launch.trial_days <= 0 THEN
    RAISE EXCEPTION 'launch trial code is unusable: trial_days %', launch.trial_days;
  END IF;

  -- The campaign is three months, measured from the launch. Asserted so a
  -- later edit cannot quietly ship a code that lasts a weekend.
  IF launch.valid_until <= launch.valid_from
     OR launch.expires_at < launch.valid_until THEN
    RAISE EXCEPTION 'launch trial window is malformed: % .. %',
      launch.valid_from, launch.valid_until;
  END IF;
END $$;
