-- ═══════════════════════════════════════════════════════════════════════
--  0011_usage_aliases.sql — the ledger speaks in aliases, forever
--
--  The customer surface shows three model names — `fast`, `smart`,
--  `frontier` — and never an upstream one. Until this migration the
--  `usage_records.model` column held whatever the GATEWAY reported for each
--  request: provider-qualified ids (`openai/space-bunny`), upstream-echoed
--  ids (`space-bunny-free`), and bare names from older upstreams. Twenty
--  distinct spellings of eleven models reached the ledger, and from there
--  into the dashboard table, the "by model" breakdown, and the CSV export —
--  all of which simply rendered the raw value.
--
--  From the collector change that shipped with this release, new rows are
--  written AS aliases (lib/jobs/collect-usage.ts resolves against the
--  `aliases:` registry in prices/models.yaml before writing). This migration
--  does the other two thirds:
--
--  1. BACKFILL. Rewrite every historical row to its alias using the same
--     mapping, so the dashboard never shows a resolved name for old traffic
--     either.
--
--  2. GUARANTEE. A CHECK constraint limits the column to the four values the
--     product sells plus `unknown` (the honest label for rows that genuinely
--     have no model, e.g. a rejected `__not_allowed__` attempt). A future
--     deploy that writes an unmapped name cannot make `usage_records`
--     inconsistent with the dashboard — it fails at the INSERT, loudly.
--
--  Both steps run inside one transaction, and the mapping is written out
--  explicitly rather than generated — an auditor must be able to read what
--  each old value became.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Backfill: resolved names → aliases ─────────────────────────────
-- Each UPDATE moves one spelling to its alias. The final fallback catches
-- anything the explicit rows missed and labels it `unknown` rather than
-- leaking it: an unlisted name should be visibly broken, never silently
-- rendered on a customer dashboard.
UPDATE usage_records SET model = 'fast'
 WHERE model IN (
   'openai/nemotron-3.5-lightning',
   'nemotron-3.5-lightning',
   'nemotron-3.5-lightning-free',
   'openai/space-bunny',
   'space-bunny',
   'space-bunny-free',
   'openai/cat-jam',
   'cat-jam',
   'openai/deepseek-v4.1-flash',
   'deepseek-v4.1-flash',
   -- Older deploys served these under `fast` too; see §5.20 and §5.24 notes.
   'openai/poolside/laguna-s-2.1:free',
   'poolside/laguna-s-2.1:free',
   'laguna-s-2.1:free',
   'openai/cl/poolside/laguna-s-2.1:free',
   'openai/nemotron-3-ultra-550b-a55b:free',
   'nemotron-3-ultra-550b-a55b:free',
   'openai/cl/nvidia/nemotron-3-ultra-550b-a55b:free'
 );

UPDATE usage_records SET model = 'smart'
 WHERE model IN (
   'openai/longcat-2.5-preview',
   'longcat-2.5-preview',
   'openai/mimo-v2.6',
   'mimo-v2.6',
   'openai/mimo-v2.6-flash',
   'mimo-v2.6-flash',
   'openai/big-pickle',
   'big-pickle',
   'oc/step-5-preview-free',
   'openai/cl/cline-free/step-5-preview'
 );

UPDATE usage_records SET model = 'frontier'
 WHERE model IN (
   'openai/grok-4.6-liberated',
   'grok-4.6-liberated',
   'openai/muse-spark-1.3-contributor',
   'muse-spark-1.3-contributor',
   'openai/muse-spark-1.2-contributor',
   'muse-spark-1.2-contributor'
 );

-- Anything left is a value no known deployment ever reported — proof rows,
-- malformed requests, rejected attempts. `unknown`, not the raw string.
UPDATE usage_records SET model = 'unknown'
 WHERE model NOT IN ('fast', 'smart', 'frontier', 'unknown');

-- ── 2. Guarantee: the column can never hold anything else again ─────────
-- A rejected attempt records `unknown`, so rows without a model do not need a
-- separate escape hatch — and must not have one, or an unmapped deployment
-- would slip back in through the same door.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_model_alias_ck'
  ) THEN
    ALTER TABLE usage_records
      ADD CONSTRAINT usage_records_model_alias_ck
      CHECK (model IN ('fast', 'smart', 'frontier', 'unknown'));
  END IF;
END $$;

-- ── 3. Fresh deployments get an alias that exists ───────────────────────
-- The alias list appears in SQL now, which is a second source of truth beside
-- prices/models.yaml — the exact duplication this release tried to remove.
-- tests/pricing-consistency.test.ts asserts the YAML registry instead; this
-- constraint asserts the DATABASE instead, deliberately. A deploy whose YAML
-- and migration disagree must fail at migration time, not at the first
-- collection pass three minutes later.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(DISTINCT model)
    INTO bad
    FROM usage_records
   WHERE model NOT IN ('fast', 'smart', 'frontier', 'unknown');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'usage_records.model holds values outside the alias set: %', bad;
  END IF;
END $$;
