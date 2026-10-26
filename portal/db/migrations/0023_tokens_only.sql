-- ══════════════════════════════════════════════════════════════════════
--  0023_tokens_only.sql — make blended tokens the ONLY quota.
--
--  0022 introduced token budgets alongside prompt counts. This migration
--  retires prompts as a quota entirely:
--
--    1. Every plan carries a token budget for each served alias.
--    2. plans.prompt_limits / trial_codes.prompt_limits stop being read by
--       any code path — there is no second limit to consult, so the wall
--       cannot drift back. The columns are dropped by a follow-up release
--       (see the phase-1 note below) to avoid breaking the previous image
--       during the deploy window.
--    3. usage_records.prompt_count is KEPT. It is an append-only ledger
--       column used for historical analytics, never for enforcement.
--
--  Wall after this migration:
--    allowed = entitled WHERE tokens_used < token_limit
--    tokens_used = input + output + cache_write_5m + cache_write_1h
--                  + cache_read   (see lib/entitlements/quota.ts)
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── Token budget columns (idempotent: 0022 may not have run yet) ───────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS token_limits jsonb NOT NULL DEFAULT '{}';
ALTER TABLE trial_codes ADD COLUMN IF NOT EXISTS token_limits jsonb NOT NULL DEFAULT '{}';

-- Any plan with no budget at all gets a generous ceiling rather than
-- unlimited, so a forgotten field cannot grant unbounded access. The
-- shipped tiers are overwritten below with their real budgets.
UPDATE plans
   SET token_limits = '{"fast": 100000000, "smart": 100000000, "frontier": 100000000}'::jsonb,
       updated_at = now()
 WHERE COALESCE(token_limits, '{}'::jsonb) = '{}'::jsonb;

-- ── Shipped budgets ────────────────────────────────────────────────────
-- Starter: fast 80M + smart 32M (~112M blended) → ~$219 COGS.
UPDATE plans SET
  token_limits = '{"fast": 80000000, "smart": 32000000}'::jsonb,
  updated_at = now()
WHERE code = 'starter';

-- Pro: smart 210M + frontier 85M (~295M blended) → ~$2,372 COGS.
UPDATE plans SET
  token_limits = '{"smart": 210000000, "frontier": 85000000}'::jsonb,
  updated_at = now()
WHERE code = 'pro';

-- Trial (hidden plan): fast 10M + smart 10M (~20M) → ~$50 COGS, free.
UPDATE plans SET
  token_limits = '{"fast": 10000000, "smart": 10000000}'::jsonb,
  updated_at = now()
WHERE code = 'trial';

-- Trial code carries the same budgets so redemption works even before the
-- plan row is resolved.
UPDATE trial_codes SET
  token_limits = '{"fast": 10000000, "smart": 10000000}'::jsonb
WHERE code = 'ZAINO-FREE-OCT26';

-- ── Retire prompt quotas (phase 1: stop reading them) ──────────────────
-- The columns are deliberately NOT dropped in this release. Migrations run
-- BEFORE `docker compose up --build`, so a DROP here would 500 every plan
-- query on the still-running previous image for the whole build window.
-- Removal is two-phase: this release ships code that never reads
-- prompt_limits, and a follow-up migration drops the dead columns once it
-- is live. Nothing after this line can reintroduce a prompt wall.
--   ALTER TABLE plans DROP COLUMN IF EXISTS prompt_limits;
--   ALTER TABLE trial_codes DROP COLUMN IF EXISTS prompt_limits;

-- ── Force cached entitlements due (same mechanism as 0010/0019/0022) ───
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
