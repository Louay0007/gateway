-- Migration 0013: Prompt-based limits
--
-- Migrate from token-budget enforcement to prompt-count limits.
-- Each inference request (chat_completions, responses) counts as 1 prompt.
-- Token stats remain visible for transparency but are no longer the limit.
--
-- Plans carry per-alias prompt limits in JSONB: {fast: 500, smart: 250}
-- Usage records track prompt_count (always 1 for inference rows).

-- Add prompt limits to plans (JSONB: {fast: 500, smart: 250})
ALTER TABLE plans ADD COLUMN prompt_limits jsonb NOT NULL DEFAULT '{}';

-- Add prompt_count column to usage_records
ALTER TABLE usage_records ADD COLUMN prompt_count integer NOT NULL DEFAULT 0;

-- Backfill: every existing inference row = 1 prompt
UPDATE usage_records SET prompt_count = 1 WHERE route IN ('chat_completions', 'responses');

-- Seed plan prompt limits
UPDATE plans SET prompt_limits = '{"fast": 500, "smart": 250}' WHERE code = 'starter';
-- Pro: 1000 Fast (Sonnet 5) + 500 Smart (Opus 5.5). Frontier removed from
-- this tier; kept only on higher tiers if any are added later.
UPDATE plans SET prompt_limits = '{"fast": 1000, "smart": 500}', models = '{fast,smart}' WHERE code = 'pro';