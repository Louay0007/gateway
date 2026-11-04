-- ══════════════════════════════════════════════════════════════════════
--  0028_fresh_input_tokens.sql — stop counting cached tokens twice.
--
--  THE BUG. `usage_records.input_tokens` was populated from LiteLLM's
--  `prompt_tokens`, which is INCLUSIVE of `cached_tokens` (OpenAI
--  semantics, and — verified against the live spend log — inclusive on
--  the Anthropic `/v1/messages` path too). Every blended-token sum then
--  added `input_tokens + cache_read_tokens`, so the cached portion was
--  counted twice.
--
--  Measured on production before this migration:
--
--    input 297807 | cache_read 297289 | genuinely fresh   518
--    blended (old formula)                             595926   ← 2×
--    blended (correct)                                 298637   = total_tokens
--
--  The identity that proves it: prompt_tokens + completion_tokens =
--  total_tokens, and total_tokens already includes the cached reads. So
--  the correct blended count is fresh_input + cache_writes + cache_read
--  + output, which equals prompt_tokens + output_tokens.
--
--  MONEY WAS NEVER WRONG. `cost_upstream_usd` comes from LiteLLM's
--  `row.spend`, which prices cache reads at the cache rate. This defect
--  only affected the TOKEN WALL (customers were cut early) and the
--  dashboards (reported ~2× usage on cache-heavy workloads).
--
--  WHY A STORED COLUMN AND NOT A FORMULA AT READ TIME. The same sum is
--  written in six places (quota wall, dashboard bundle, admin financials,
--  rollup job, chart query, /api/models). A query-time expression would
--  have to be repeated in each, and one divergence is exactly the class
--  of bug this migration exists to fix. Store the normalised value once,
--  at ingest, and let every reader sum one column.
--
--  `input_tokens` KEEPS ITS RAW, INCLUSIVE MEANING. It is what the
--  provider reported and what an auditor will want to see; nothing in
--  this migration rewrites history that was recorded correctly. Only the
--  derived `fresh_input_tokens` is new.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. The normalised column ─────────────────────────────────────────
-- Nullable on purpose: NULL means "not yet normalised", which is
-- distinguishable from a genuine zero (a row whose prompt was entirely
-- cache hits). The backfill fills every existing row; the collector
-- writes it for every new one. A NULL surviving into a quota window is
-- then a real defect and the wall can be made to say so, instead of
-- silently counting a zero.
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS fresh_input_tokens integer;

COMMENT ON COLUMN usage_records.fresh_input_tokens IS
  'Input tokens EXCLUDING cache reads. input_tokens is inclusive (provider '
  'prompt_tokens); blended = fresh_input_tokens + cache_writes + '
  'cache_read_tokens + output_tokens, which equals prompt+completion. 0028.';

-- ── 2. Backfill every historical row ─────────────────────────────────
-- GREATEST(..., 0) guards the one shape this could get wrong: a provider
-- that reports `input_tokens` EXCLUSIVE of cache reads, where
-- cache_read > input would otherwise produce a negative. No row in the
-- live table has that shape (verified: 0 rows with cr > input), so this
-- is a belt-and-braces guard rather than an expected branch.
UPDATE usage_records
   SET fresh_input_tokens = GREATEST(input_tokens - cache_read_tokens, 0)
 WHERE fresh_input_tokens IS NULL;

-- ── 3. Index for the quota wall ──────────────────────────────────────
-- The wall sums per (organization, alias) over a Tunis day. The existing
-- org_occurred_idx covers the range scan; this partial index keeps the
-- new column cheap to aggregate for orgs that have any usage at all.
CREATE INDEX IF NOT EXISTS usage_records_org_fresh_idx
  ON usage_records (organization_id, occurred_at)
  WHERE fresh_input_tokens IS NOT NULL;

-- ── 4. Guard: every row must be normalised after this migration ──────
-- A NULL left behind means the backfill missed a row and every blended
-- sum that reads the new column would under-count it. Fail the migration
-- loudly instead of shipping a quiet hole in the ledger.
DO $$
DECLARE
  missing bigint;
BEGIN
  SELECT count(*) INTO missing
    FROM usage_records
   WHERE fresh_input_tokens IS NULL;

  IF missing > 0 THEN
    RAISE EXCEPTION
      '0028: % usage_records row(s) still have fresh_input_tokens NULL after backfill',
      missing;
  END IF;
END $$;
