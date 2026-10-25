-- 0021_extend_trial_oct31.sql — free trial campaign runs to 1 Nov 00:00 Tunis.
--
-- ZAINO-FREE-OCT26 was capped 2026-10-22T23:59:59+01:00. The operator extends
-- the campaign to 2026-10-31T23:59:59+01:00 (Africa/Tunis is UTC+1
-- year-round, no DST), so the trial ends 1 Nov at 00:00 local time.
--
-- Three things move together:
--   1. trial_codes.valid_until / expires_at — new redemptions stay open
--      until the cutoff. Per-redeemer expiry is unchanged:
--      min(now + trial_days, expires_at).
--   2. Live `trialing` subscriptions on the hidden `trial` plan — trial_end
--      and current_period_end move to the cutoff, so current trial users
--      keep access instead of being cut on the next expire_trials run
--      (which 0021's companion fix finally lets complete).
--   3. trial_redemptions.expires_at for those rows — informational, kept
--      consistent with the subscription.
--
-- Untouched: paid (`active`) subscriptions that redeemed the code,
-- already-canceled rows, trial_days (stays 3), limits ({fast:300,
-- smart:300}). Fresh installs match zero subscription rows — harmless.
--
-- FORWARD-ONLY. Recovery is `make restore`.

UPDATE trial_codes
   SET valid_until = '2026-10-31T23:59:59+01:00'::timestamptz,
       expires_at  = '2026-10-31T23:59:59+01:00'::timestamptz
 WHERE code = 'ZAINO-FREE-OCT26';

UPDATE subscriptions s
   SET trial_end = '2026-10-31T23:59:59+01:00'::timestamptz,
       current_period_end = '2026-10-31T23:59:59+01:00'::timestamptz,
       updated_at = now()
  FROM plans p
 WHERE s.plan_id = p.id
   AND p.code = 'trial'
   AND s.status = 'trialing';

UPDATE trial_redemptions r
   SET expires_at = '2026-10-31T23:59:59+01:00'::timestamptz
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
 WHERE r.subscription_id = s.id
   AND p.code = 'trial'
   AND s.status = 'trialing';
