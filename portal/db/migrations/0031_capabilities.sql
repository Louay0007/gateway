-- ══════════════════════════════════════════════════════════════
--  0031_capabilities.sql — the capability layer.
--
--  Audit items 4, 5, 7, 11, 12, 13, 15 and the depth items in §3.
--  Files (0030) and search are already in.
--
--  ORGANISED BY WHAT OWNS THE LIFECYCLE, not by audit number,
--  because that is what decides the ON DELETE behaviour and the
--  retention story:
--
--    projects       user-owned grouping. Archive, never hard-delete,
--                   or every conversation inside loses its parent.
--    memories       extracted facts, one row per fact, so a user can
--                   delete ONE without wiping everything remembered.
--    shares       a deliberate, revocable grant. Must cascade from
--                   the conversation: a deleted chat cannot stay
--                   reachable by a public link.
--    scheduled_prompts
--                   a cron-ish job the user owns. Cascades from the
--                   user and the conversation.
--    custom_instructions
--                   the "about me / how to respond" pair. Global and
--                   per-user, separate from chat_presets because it
--                   is not a generation parameter and must not be
--                   overridable per chat.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

-- ── 1. projects (audit #5) ────────────────────────────────────────────
-- A folder with its own instructions and files. Chat keeps working
-- without it: `conversations.project_id` is nullable and the sidebar
-- renders unparented chats as before, so this is additive.
CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Prepended to every turn in every conversation in this project,
  -- after custom instructions and before the per-chat prompt.
  instructions    text NOT NULL DEFAULT '',
  -- A colour key the UI maps to a swatch. Text, not an enum: a new
  -- palette entry must not be a migration.
  color           text NOT NULL DEFAULT 'default',

  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_idx
  ON projects (user_id, updated_at DESC);

-- One name per user among live projects. Case-insensitive: "Work" and
-- "work" as two folders is a typo, not an intention.
CREATE UNIQUE INDEX IF NOT EXISTS projects_user_name_idx
  ON projects (user_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

-- Conversations belong to at most one project. `ON DELETE SET NULL`,
-- not CASCADE: deleting a folder must not delete the chats inside it.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON conversations (project_id, last_message_at DESC)
  WHERE project_id IS NOT NULL;

-- ── 2. memories (audit #4) ────────────────────────────────────────────
-- ONE ROW PER FACT. A single jsonb blob per user was the tempting
-- design and it fails the trust requirement: the audit says "viewable/
-- editable/deletable", and a blob cannot delete fact #3 without a
-- read-modify-write that races a concurrent extraction job.
--
-- `source_conversation_id` is ON DELETE SET NULL so a memory survives
-- the chat it was learned in — that is the point of memory — while
-- still being attributable when the chat exists.
CREATE TABLE IF NOT EXISTS memories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content                 text NOT NULL CHECK (length(btrim(content)) > 0),
  -- Free-form so the UI can group ("work", "preferences") without a
  -- migration, and so an extraction job can invent one.
  category                text NOT NULL DEFAULT 'general',

  -- Where it came from, for a "why do you know this?" affordance.
  source_conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,

  -- The user can pin a memory the extractor would otherwise prune.
  pinned                  boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Bumped when re-extracted, so the prompt can prefer recent facts.
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- A hash of the normalised content, so a re-extraction pass that
  -- rediscovers the same fact is a no-op instead of a duplicate row.
  -- Scoped per user, not globally.
  content_key             text
);

-- NOT a partial index, deliberately. A `WHERE content_key IS NOT NULL`
-- predicate would be marginally smaller, but Postgres cannot infer a
-- partial index from `ON CONFLICT (user_id, content_key)`, and the insert
-- in lib/chat/memory.ts would fail at runtime with
-- "no unique or exclusion constraint matching the ON CONFLICT
-- specification". NULLs are already distinct in a unique index, so a row
-- with no key (only written by a future import path) costs nothing.
CREATE UNIQUE INDEX IF NOT EXISTS memories_user_key_idx
  ON memories (user_id, content_key);

CREATE INDEX IF NOT EXISTS memories_user_idx
  ON memories (user_id, created_at DESC);

-- ── 3. shares (audit #11) ─────────────────────────────────────────────
-- A public link to a conversation. Three properties matter:
--
--   * the token is stored HASHED, like a password. A leaked database
--     dump must not yield working links; the raw token exists only in
--     the URL we hand the user once.
--   * it expires. A share that lives forever is a data-retention
--     incident waiting for the first forgotten link.
--   * revoking is a row update, so "unshare" is instant and auditable
--     rather than depending on the client forgetting a URL.
CREATE TABLE IF NOT EXISTS conversation_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- sha256 of the raw token. Lookup is by hash, so the plaintext never
  -- needs to be recoverable.
  token_hash      text NOT NULL UNIQUE,

  -- Partial shares: if non-null, only messages up to this point are
  -- visible. A long chat often has one answer worth sharing.
  through_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,

  expires_at      timestamptz,
  revoked_at      timestamptz,
  view_count      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_shares_conv_idx
  ON conversation_shares (conversation_id)
  WHERE revoked_at IS NULL;

-- ── 4. custom instructions (audit #13) ────────────────────────────────
-- Deliberately NOT in chat_presets: those are generation PARAMETERS
-- resolved per alias and per chat, and a user must not be able to
-- override "who I am" from one conversation's settings. One row per
-- user; upsert on write.
CREATE TABLE IF NOT EXISTS custom_instructions (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- "What should the model know about you."
  about_user    text NOT NULL DEFAULT '',
  -- "How should the model respond."
  response_style text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 5. scheduled prompts (audit #15) ──────────────────────────────────
-- A recurring prompt the jobs runner executes. The runner already
-- exists (`scripts/jobs.ts`, `job_runs`), so this reuses that
-- infrastructure rather than adding a second scheduler.
CREATE TABLE IF NOT EXISTS scheduled_prompts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Where results land. SET NULL so deleting the target chat keeps the
  -- schedule (the user can retarget) instead of silently dropping it.
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,

  title           text NOT NULL DEFAULT '',
  prompt          text NOT NULL CHECK (length(btrim(prompt)) > 0),
  alias           text NOT NULL DEFAULT 'smart',

  -- Minutes between runs. A floor is enforced in code, not here, so
  -- the limit can change without a migration.
  every_minutes   integer NOT NULL CHECK (every_minutes > 0),
  enabled         boolean NOT NULL DEFAULT true,

  last_run_at     timestamptz,
  next_run_at     timestamptz NOT NULL DEFAULT now(),
  last_status     text,
  last_error      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The runner's claim query: due, enabled, ordered.
CREATE INDEX IF NOT EXISTS scheduled_prompts_due_idx
  ON scheduled_prompts (next_run_at)
  WHERE enabled;

-- ── 6. temporary chats (audit #12) ────────────────────────────────────
-- A chat marked temporary is excluded from memory extraction and from
-- the search index, and is never shared. It is NOT deleted-on-close:
-- the user may want it until they close it, and a purge job is the
-- honest implementation (retention, not a UI promise).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS temporary boolean NOT NULL DEFAULT false;

-- ── 7. message edit / branch (audit #7) ───────────────────────────────
-- Editing a user turn does not mutate history in place. The old turn is
-- marked superseded (same mechanism as regenerate, 0026) and the new
-- one carries a `parent_message_id`, which is what makes "branch" a
-- fact: a conversation's visible transcript is one path through this
-- DAG, and forking is choosing a different parent.
--
-- `active_branch_head` on the conversation records which leaf is
-- currently shown, so switching branches is one nullable-column read
-- rather than a tree walk on every render.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS active_branch_head uuid REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_parent_idx
  ON messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- ── 8. reasoning effort + per-turn attribution (audit #14, §3.4) ──────
-- `reasoning_effort` is a generation setting, so it rides in the
-- existing jsonb rather than a column — see lib/chat/preset.ts. What
-- needs a column is the RESULT: what effort was actually used, so the
-- transcript can show "max effort, 12s" and the usage tab can explain a
-- slow turn.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reasoning_effort text;

-- How much extracted text this turn actually carried, in characters.
-- Stored because the cost of a turn with a 200-page PDF is confusing
-- otherwise: the token count is in `input_tokens`, and this is the input
-- that CAUSED it. Zero for a turn with no files, so no backfill is needed.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_chars integer NOT NULL DEFAULT 0;

-- ── 9. retention (audit §3.6) ─────────────────────────────────────────
-- `plans.features.history_days` exists (90/365) and was never enforced.
-- The purge job needs to find expired conversations cheaply, and it must
-- never touch a pinned or shared one.
CREATE INDEX IF NOT EXISTS conversations_retention_idx
  ON conversations (last_message_at)
  WHERE archived_at IS NULL AND pinned_at IS NULL;

-- ── 10. Seed the two job ledgers ──────────────────────────────────────
-- A job runs only when it is BOTH in `scripts/jobs.ts` JOBS and in this
-- table (the lock is a row in `job_runs`, so a missing row means the job
-- silently never runs). Seeding here is what makes registering one line.
INSERT INTO job_runs (name) VALUES
  ('run_schedules'),
  ('enforce_retention')
ON CONFLICT (name) DO NOTHING;
