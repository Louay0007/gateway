-- ══════════════════════════════════════════════════════════════════════
--  0022_token_limits.sql — per-alias TOKEN budgets (blended tokens).
--
--  Context: the dashboard `Tokens` card is SUM(input+output+cache) over the
--  whole subscription period, while Claude/Codex show the CURRENT context.
--  An agentic client resends full history every turn, so
--  Portal_total ≈ N_turns × avg_context. Token budgets must therefore be
--  sized for CUMULATIVE resend, not single-context.
--
--  Blended-token math (same for all tiers):
--    billable_tokens = input + output + cache_write_5m + cache_write_1h
--                      + cache_read   (see lib/pricing billableTokens())
--    upstream COGS priced from prices/models.yaml at list rates,
--    customer value = COGS × rate_multiplier (1.30 Starter / 1.25 Pro).
--
--  Budgets (15× Starter / 30× Pro):
--    Starter: fast 80M + smart 32M (~112M total) → ~$219 COGS → ~$285 @1.30
--    Pro:     smart 210M + frontier 85M (~295M)  → ~$2,372 COGS → ~$2,965 @1.25
--    Trial:   fast 10M + smart 10M (~20M)        → ~$50 COGS, free
--
--  Enforcement (backend, this migration enables):
--    allowed = entitled WHERE prompts_used < prompt_limit
--                        AND tokens_used  < token_limit
--  Missing token entry = UNLIMITED (backward compat until every plan is
--  backfilled); missing prompt entry = DENY (existing rule, unchanged).
--  The wall lives in lib/entitlements/quota.ts + allowed-models.ts; the
--  5-minute enforce_prompt_limits job enforces BOTH (no new job row needed).
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── plans.token_limits ────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS token_limits jsonb NOT NULL DEFAULT '{}';

-- ── trial_codes.token_limits (per-code override, falls back to plan) ──
ALTER TABLE trial_codes ADD COLUMN IF NOT EXISTS token_limits jsonb NOT NULL DEFAULT '{}';

-- ── Budgets ───────────────────────────────────────────────────────────
-- Starter: fast 80M, smart 32M
UPDATE plans SET
  token_limits = '{"fast": 80000000, "smart": 32000000}'::jsonb,
  updated_at = now()
WHERE code = 'starter';

-- Pro: smart 210M, frontier 85M (fast is Starter-only since 0019)
UPDATE plans SET
  token_limits = '{"smart": 210000000, "frontier": 85000000}'::jsonb,
  updated_at = now()
WHERE code = 'pro';

-- Trial (hidden plan): fast 10M, smart 10M
UPDATE plans SET
  token_limits = '{"fast": 10000000, "smart": 10000000}'::jsonb,
  updated_at = now()
WHERE code = 'trial';

-- Trial code default (per-code override used at redeem time if plan missing)
UPDATE trial_codes SET
  token_limits = '{"fast": 10000000, "smart": 10000000}'::jsonb
WHERE code = 'ZAINO-FREE-OCT26';

-- ── Force cached entitlements due (same mechanism as 0010/0019) ───────
-- planForOrg() reads the cached row first; without this, widened token
-- budgets take up to an hour to reach the gateway wall.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── Guard: every served alias on a paid plan must have a token budget ──
-- Trial is included: a trial without token budgets would run unlimited.
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
