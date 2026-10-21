-- ══════════════════════════════════════════════════════════════════════
--  0018_frontier_pro.sql — restore `frontier` to the Pro plan
--
--  Migration 0013 narrowed Pro to {fast, smart} while frontier metering
--  was deferred. Frontier is now served by Opus 5.5 on the AiPilot
--  upstream, so restore it to Pro with its own prompt allowance.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

UPDATE plans SET
  models = ARRAY['fast', 'smart', 'frontier'],
  prompt_limits = '{"fast": 1000, "smart": 500, "frontier": 250}'::jsonb,
  updated_at = now()
WHERE code = 'pro';
