-- ══════════════════════════════════════════════════════════════════════
--  0036_november_trial.sql — the November trial campaign.
--
--  ZAINO-FREE-OCT26 hit valid_until 2026-10-31T23:59:59+01:00 (0021), so
--  since 1 November every redemption answers 410 code_expired. The trial
--  page notices (`hasRedeemableTrialCode`) and says the campaign ended,
--  which is honest but is not a product.
--
--  Same settings as the October campaign, per the operator — nothing about
--  the offer changes:
--
--    trial_days     3
--    models         fast, smart
--    token_limits   100M per alias (matches 0035, which is what the
--                   October code carries today)
--    redemptions    unlimited (max_redemptions 0)
--    per-org limit  one redemption per code (trial_redemptions UNIQUE)
--
--  Only the window moves: valid_from 2026-11-01, valid_until 2026-11-30
--  23:59:59 Africa/Tunis (UTC+1, no DST). Expiry is still
--  min(now + trial_days, expires_at), so a late-November redemption gets
--  the days that are actually left rather than a trial that outlives the
--  campaign.
--
--  The October code is left ACTIVE with its expired window rather than
--  deactivated: `redeemTrialCode` checks the dates anyway, and an inactive
--  row would report "no longer active" to someone holding a real code
--  instead of the accurate "expired". Historical redemptions keep pointing
--  at it.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO trial_codes (
  code,
  created_by,
  max_redemptions,
  models,
  prompt_limits,
  token_limits,
  trial_days,
  valid_from,
  valid_until,
  expires_at,
  active
)
VALUES (
  'ZAINO-FREE-NOV26',
  'system',
  0,
  ARRAY['fast', 'smart'],
  '{"fast":300,"smart":300}'::jsonb,
  '{"fast":100000000,"smart":100000000}'::jsonb,
  3,
  '2026-11-01T00:00:00+01:00',
  '2026-11-30T23:59:59+01:00',
  '2026-11-30T23:59:59+01:00',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

-- Guard: the code carries a budget for every alias it grants. A code with
-- an empty token_limits redeems successfully and then hits an unlimited
-- wall. The WINDOW is deliberately not asserted — migrations run on every
-- clone forever, and after 30 November this file would start failing a
-- fresh install for a campaign that is simply over.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT tc.code
    INTO bad
    FROM trial_codes tc
   WHERE tc.code = 'ZAINO-FREE-NOV26'
     AND (
       COALESCE((tc.token_limits ->> 'fast')::bigint, 0) <= 0
       OR COALESCE((tc.token_limits ->> 'smart')::bigint, 0) <= 0
     );

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'November trial code is unusable: %', bad;
  END IF;
END $$;
