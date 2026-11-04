-- ══════════════════════════════════════════════════════════════
--  0030_attachments.sql — file and image input.
--
--  The audit's single largest gap. Two tables, because a file is
--  attached to ONE turn but may be reused across many, and the two
--  have different lifetimes:
--
--    attachments   the bytes' identity + extracted text. Keyed by a
--                  content hash so the same PDF uploaded twice costs
--                  one extraction, not two — and so dedupe is a fact
--                  (the hash) rather than a guess (the filename).
--    message_attachments
--                  the join. A message can carry several files and a
--                  file can appear in several messages, so neither
--                  side can hold the foreign key.
--
--  WHY `extracted_text` IS STORED, NOT RECOMPUTED. Extraction is
--  expensive (a 200-page PDF takes seconds) and immutable for a given
--  hash. Recomputing on every render would make a transcript scroll
--  slower the more files it contains.
--
--  WHY IMAGES HAVE NO TEXT. A vision model receives pixels; storing an
--  empty string and `kind='image'` lets the prompt builder include the
--  image and skip the text path, instead of sending nothing and
--  silently losing the attachment.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

-- ── 1. attachments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The IDOR guard, as everywhere else: every read filters by org.
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Uploader. Kept so a shared org file still has a responsible party
  -- and so deleting a user's data can find their uploads.
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- sha256 of the raw bytes, hex. Unique per org, not globally: two
  -- tenants uploading the same public PDF must not share a row, or
  -- deleting one tenant's file would blank the other's attachment.
  content_hash    text NOT NULL,

  filename        text NOT NULL,
  mime_type       text NOT NULL DEFAULT 'application/octet-stream',
  byte_size       bigint NOT NULL CHECK (byte_size >= 0),

  -- pdf | docx | sheet | text | image — mirrors ExtractedKind in the
  -- engine. Text kinds are searchable; images are not.
  kind            text NOT NULL DEFAULT 'text',

  -- Text the model may read. Empty for images, which are passed as
  -- pixels. `NOT NULL` with a default so the prompt builder never has
  -- to distinguish NULL from "".
  extracted_text  text NOT NULL DEFAULT '',
  -- True when the engine clamped the text (head+tail kept).
  truncated       boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Dedupe lookup: "have we already extracted this exact file for this
-- org?" is the hot path on every upload.
CREATE UNIQUE INDEX IF NOT EXISTS attachments_org_hash_idx
  ON attachments (organization_id, content_hash);

-- Listing a user's files, newest first.
CREATE INDEX IF NOT EXISTS attachments_user_idx
  ON attachments (user_id, created_at DESC);

-- ── 2. message_attachments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_attachments (
  message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  -- Presentation order in the composer, and lets the same file be sent
  -- twice in one message if the user really means to.
  position      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, attachment_id, position)
);

CREATE INDEX IF NOT EXISTS message_attachments_attachment_idx
  ON message_attachments (attachment_id);

-- ── 3. conversation search support ────────────────────────────────────
-- The tantivy index in the engine serves ranked search, but the portal
-- needs a cheap "did anything in this conversation ever mention X"
-- for the in-conversation find bar, and that must survive the engine
-- being down. A generated tsvector column plus a GIN index answers it
-- in Postgres without a second search system.
--
-- `to_tsvector('simple', ...)` on purpose: the messages are already in
-- whatever language the user typed, and 'english' stemming would mangle
-- French and Arabic content. 'simple' is language-neutral and correct
-- for an app whose UI ships fr/ar/en.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS messages_content_tsv_idx
  ON messages USING GIN (content_tsv);

-- ── 4. ledger join for attachment cost ────────────────────────────────
-- Attachment tokens are billed as part of the input, and the ledger row
-- is per request. Recording the char count lets the usage tab explain
-- a surprising input-token number ("this turn included a 40k-char PDF")
-- without re-reading the file.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_chars integer NOT NULL DEFAULT 0;
