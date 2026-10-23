-- 0020_prompt_count_fix.sql — one user message = one prompt, enforced.
--
-- Rule: prompt_count = 1 IFF route is inference (chat/messages/responses)
-- AND status_code = 200. Everything else (failures, 429s, /v1/models,
-- unknown) is 0. Failures must never consume quota.
--
-- Also canonicalizes legacy `chat_completions` route → `chat` so one wire
-- format is one route, adds prompts to usage_periods, and forces cached
-- entitlements due so the next reconcile re-asserts correct limits.

-- Canonicalize legacy route spelling.
UPDATE usage_records SET route = 'chat' WHERE route = 'chat_completions';

-- Re-derive every prompt_count from the single rule (idempotent).
UPDATE usage_records
   SET prompt_count = CASE
     WHEN route IN ('chat', 'messages', 'responses')
      AND status_code = 200 THEN 1
     ELSE 0
   END;

-- Guard: prompt_count is a bit, not a counter.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_prompt_count_ck') THEN
    ALTER TABLE usage_records
      ADD CONSTRAINT usage_records_prompt_count_ck CHECK (prompt_count IN (0, 1));
  END IF;
END $$;

-- usage_periods carries prompts so charts read the cache, not the ledger.
ALTER TABLE usage_periods ADD COLUMN IF NOT EXISTS prompts BIGINT NOT NULL DEFAULT 0;

-- Rebuild rollups for existing periods (ledger is source of truth).
UPDATE usage_periods p SET prompts = sub.prompts FROM (
  SELECT organization_id, billing_period, COALESCE(SUM(prompt_count),0)::bigint AS prompts
    FROM usage_records GROUP BY 1,2
) sub
WHERE sub.organization_id = p.organization_id AND sub.billing_period = p.billing_period;

-- Force cached entitlements due so reconcile re-pushes correct limits.
UPDATE entitlements SET synced_at = synced_at - INTERVAL '2 hours' WHERE synced_at IS NOT NULL;

-- Scheduled job for server-side prompt-limit enforcement.
INSERT INTO job_runs (name) VALUES ('enforce_prompt_limits') ON CONFLICT (name) DO NOTHING;
