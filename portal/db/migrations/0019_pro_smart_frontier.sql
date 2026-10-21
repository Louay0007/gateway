-- ══════════════════════════════════════════════════════════════════════
--  0019_pro_smart_frontier.sql — Pro becomes Smart 1000 + Frontier 500
--
--  Pro was {fast: 1000, smart: 500, frontier: 250}. The product decision
--  is now: Pro = {smart: 1000, frontier: 500} — Sonnet 5.5 for everyday
--  work, Opus 5.5 for the hard tasks. Fast (Haiku 5.5) stays Starter-only.
--
--  Narrowing, not widening: existing Pro keys minted for `fast` lose it on
--  the next entitlement sync (team + key models are pushed from plans.models,
--  so the intersection converges). The cached entitlement snapshot is forced
--  due (same mechanism as 0010) so no org keeps the old allowlist for up
--  to an hour.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

UPDATE plans SET
  models = ARRAY['smart', 'frontier'],
  prompt_limits = '{"smart": 1000, "frontier": 500}'::jsonb,
  updated_at = now()
WHERE code = 'pro';

-- Force every cached entitlement row due right now (see 0010 for why:
-- planForOrg() reads the cached row first).
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- Guard: no plan may advertise an alias the gateway does not serve.
DO $$
DECLARE
  served text[] := ARRAY['fast', 'smart', 'frontier'];
  bad    text[];
BEGIN
  SELECT array_agg(m)
    INTO bad
    FROM plans, unnest(models) AS m
   WHERE m <> ALL (served);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plans.models references aliases the gateway does not serve: %', bad;
  END IF;
END $$;
