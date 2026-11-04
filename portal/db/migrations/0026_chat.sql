-- ══════════════════════════════════════════════════════════════
--  0026_chat.sql — the chat product's own tables.
--
--  Four things, and each one exists because something else cannot
--  answer the question:
--
--    conversations  the sidebar's list. Org- AND user-scoped: an
--                   organisation is the billing tenant, but a
--                   conversation is personal, so the org filter is the
--                   IDOR guard and the user filter is the product rule.
--    messages       one row per turn. `status` is what makes a
--                   half-streamed answer honest instead of absent.
--    chat_credentials  a long-lived LiteLLM key per org, because the
--                   browser must never hold one and a customer's own
--                   `zn-` key is a developer credential. Reversible
--                   ciphertext, so `key_ciphertext` is bytea, not text.
--    usage_records.gateway_request_id
--                   the join that turns "this answer cost 3.2¢" into a
--                   fact read from the ledger rather than an estimate.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

-- ── 1. conversations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT 'New chat',
  -- The alias, never the resolved upstream model: the row must survive a
  -- model swap behind a tier (lib/pricing/alias.ts).
  model           text,
  -- Soft delete. A hard DELETE would take the messages with it, and those
  -- are the same turns `usage_records` was written for.
  archived_at     timestamptz,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The sidebar: one user's recent conversations, newest first. `id DESC` is
-- the tiebreak so pagination stays stable when two rows share a timestamp.
CREATE INDEX IF NOT EXISTS conversations_user_recent_idx
  ON conversations (user_id, last_message_at DESC NULLS LAST, id DESC);

-- The IDOR guard's own index: every read is filtered by org first.
CREATE INDEX IF NOT EXISTS conversations_org_idx
  ON conversations (organization_id, last_message_at DESC NULLS LAST);

-- ── 2. messages ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role               text NOT NULL CHECK (role IN ('user','assistant','system')),
  content            text NOT NULL DEFAULT '',
  model              text,
  -- Joins usage_records.gateway_request_id. NULL until the collector has
  -- seen the spend row, which is why the cost columns are nullable too.
  gateway_request_id text,
  input_tokens       integer,
  output_tokens      integer,
  cost_usd           numeric(14,8),
  status             text NOT NULL DEFAULT 'complete'
                       CHECK (status IN ('pending','streaming','complete','error','aborted')),
  error              text,
  latency_ms         integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at, id);

-- Attribution backfill: given a spend row's request id, find the turn.
CREATE INDEX IF NOT EXISTS messages_request_idx
  ON messages (gateway_request_id) WHERE gateway_request_id IS NOT NULL;

-- ── 3. chat_credentials ───────────────────────────────────────────────
-- One LiteLLM key per organization. The plaintext is needed on every
-- request, so it is stored SEALED (AES-256-GCM, `v1:` envelope, random
-- 12-byte IV per record — lib/crypto/sealed.ts), never hashed: a hash
-- cannot be presented to the gateway.
CREATE TABLE IF NOT EXISTS chat_credentials (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  litellm_key_hash text NOT NULL,
  litellm_key_name text,
  key_ciphertext   bytea NOT NULL,
  models           text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  rotated_at       timestamptz
);

-- ── 4. usage_records.gateway_request_id ───────────────────────────────
-- LiteLLM's request id. `collect_usage` already reads it for dedupeHash;
-- persisting it is what lets a message row claim its own cost.
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS gateway_request_id text;

CREATE INDEX IF NOT EXISTS usage_records_gateway_request_idx
  ON usage_records (gateway_request_id) WHERE gateway_request_id IS NOT NULL;

-- ── 5. Keep chat keys out of the customer's key ceiling ───────────────
-- `api_keys.kind` already exists (default 'personal'); nothing filtered on
-- it, so an org chat key inserted there would have eaten one of a
-- Starter customer's three slots. `countActiveKeys` now excludes 'chat',
-- and this index makes that count cheap.
CREATE INDEX IF NOT EXISTS api_keys_org_live_idx
  ON api_keys (organization_id, kind) WHERE revoked_at IS NULL;
