-- ══════════════════════════════════════════════════════════════
--  0027_chat_ui.sql — what the chat interface needs that 0026
--  did not anticipate.
--
--  Five columns and one table, and each exists because a specific
--  interaction had nowhere to store its result:
--
--    conversations.pinned_at     the sidebar groups pinned first; a
--                                boolean alone could not order them.
--    conversations.settings      per-chat generation overrides
--                                (temperature, system prompt, …).
--    messages.reasoning          thinking models stream their chain of
--                                thought separately from the answer; it
--                                is not the answer and must not be
--                                concatenated into `content`.
--    messages.meta              token counts and the model that actually
--                                answered, for the footer ("412 tokens
--                                · 1.2s").
--    chat_presets               defaults at a scope that is not a single
--                                conversation: global, or per model.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

-- ── 1. Pin. Nullable timestamp, not a boolean: the sidebar needs to
--       order pinned rows by when they were pinned, and `pinned = true`
--       cannot express that without a second column.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

-- Partial index: the pinned group is a handful of rows, and the common
-- query is "pinned first, then by activity", which reads this then the
-- existing recent index.
CREATE INDEX IF NOT EXISTS conversations_pinned_idx
  ON conversations (user_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- ── 2. Per-chat generation settings. jsonb, not columns: the parameter
--       set is the provider's, not ours, and a new tuning knob must not
--       need a migration. Shape is GenerationSettings in
--       lib/chat/settings.ts, which validates on read.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS settings jsonb;

-- ── 3. Reasoning. Separate from `content` because it is not the answer:
--       copying a reply must not copy the model's deliberation, and the
--       UI collapses it separately. Existing rows default to NULL, which
--       reads as "this turn had no reasoning" — true for every model
--       without a thinking capability.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reasoning text;

-- ── 4. Per-turn stats. jsonb for the same reason as settings: eval_tokens,
--       eval_ms and the resolved model are telemetry, and adding one must
--       not be a migration. Nothing on a billing path reads this —
--       `cost_usd` and the token columns are the source of truth for
--       money, and they stay typed.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- ── 5. Presets. Two scopes exist today: '' (every chat) and a model alias
--       (every chat using that alias). A per-conversation override lives
--       on conversations.settings instead of here, so the three layers the
--       UI offers are: global → model → chat.
--
--       Keyed by (user_id, scope) and NOT by organization: these are
--       preferences, not tenant data. One person's temperature must not
--       become their colleague's.
CREATE TABLE IF NOT EXISTS chat_presets (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- '' is the global scope. A CHECK would need to know every alias, and
  -- aliases are a pricing decision, not a schema one.
  scope      text NOT NULL,
  settings   jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);
