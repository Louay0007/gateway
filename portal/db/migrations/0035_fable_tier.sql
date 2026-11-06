-- ══════════════════════════════════════════════════════════════════════
--  0035_fable_tier.sql — the fourth alias, `fable`.
--
--  `fable` is served by the provider's `gpt-6-astra` deployment. Every
--  response it returns carries `"model":"opus-5.5"`, so it is priced
--  identically to `frontier` and treated as the same capability class
--  until the provider confirms whether it is a distinct engine.
--
--  BUDGETS UNCHANGED AT 100M/ALIAS/DAY, per the operator: the wall stays
--  where it is, only the per-plan model lineup moves.
--
--    Starter: fast + smart            (unchanged)
--    Pro:     smart + frontier + fable (gains `fable`)
--    Trial:   fast + smart            (unchanged)
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- Pro gains `fable`, keeping smart + frontier. `fast` stays Starter-only.
UPDATE plans SET
  models       = ARRAY['smart', 'frontier', 'fable']::text[],
  token_limits = '{"smart": 100000000, "frontier": 100000000, "fable": 100000000}'::jsonb,
  updated_at   = now()
WHERE code = 'pro';

-- Starter and Trial keep their lineup; rewrite the budgets so a plan that
-- drifted from 100M is brought back in line with the wall this release
-- documents.
UPDATE plans SET
  token_limits = '{"fast": 100000000, "smart": 100000000}'::jsonb,
  updated_at   = now()
WHERE code IN ('starter', 'trial');

UPDATE trial_codes SET
  token_limits = '{"fast": 100000000, "smart": 100000000}'::jsonb
WHERE COALESCE(token_limits, '{}'::jsonb) <> '{"fast": 100000000, "smart": 100000000}'::jsonb;

-- ── Force cached entitlements due (same mechanism as 0010/0019/0025) ───
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── Guard: every served alias on a shipped plan has a token budget ─────
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || ':' || m)
    INTO bad
    FROM plans p, unnest(p.models) AS m
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND COALESCE((p.token_limits ->> m)::bigint, 0) <= 0;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plans missing token_limits for served aliases: %', bad;
  END IF;
END $$;
