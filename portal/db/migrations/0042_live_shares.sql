-- ══════════════════════════════════════════════════════════════════════
--  0042_live_shares.sql — a share that follows the conversation.
--
--  WHY. Until now a share was a SNAPSHOT: `through_message_id` froze the
--  link at the newest message at creation, deliberately, so that asking a
--  follow-up question did not publish the follow-up to whoever held the URL.
--  That is the right default and it stays the default.
--
--  What was missing is the opposite case: a live session where the author
--  wants the people watching to see the conversation as it happens. Today
--  that requires re-creating the link after every turn, which produces a new
--  URL each time and leaves a trail of revoked shares.
--
--  WHAT THIS ADDS. One boolean. `is_live = false` (the default, and every
--  existing row) keeps the snapshot. `is_live = true` makes
--  `through_message_id` irrelevant: the read path returns every visible
--  message, and the stream endpoint pushes new ones as they complete.
--
--  THE ASYMMETRY IS DELIBERATE. Live is opt-in per link and never the
--  default, because the two modes have opposite failure modes:
--
--    snapshot + forgotten link  → one stale conversation is exposed
--    live     + forgotten link  → everything you say is broadcast
--
--  So the column defaults to FALSE, and the UI must name the mode when a
--  link is created rather than inheriting it.
--
--  NO OTHER COLUMN CHANGES. `through_message_id` stays and keeps its
--  meaning for snapshot shares; a live share simply ignores it, which is
--  why it is not nulled — flipping `is_live` back to false restores the
--  original boundary exactly.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE conversation_shares
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN conversation_shares.is_live IS
  'True = the link follows the conversation until revoked (through_message_id is ignored). False = snapshot at through_message_id. Defaults to false: a forgotten live link broadcasts everything.';

-- ── Guard: a live share must have no boundary ────────────────────────
--  A row with both set is ambiguous — the read path would have to pick, and
--  a future reader would have to work out which. Refuse the shape instead
--  of defining it.
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM conversation_shares
   WHERE is_live = TRUE
     AND through_message_id IS NOT NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      '0042: % share(s) are marked live but still carry a through_message_id — a live link has no boundary',
      bad;
  END IF;
END $$;

-- ── Index for the poll ───────────────────────────────────────────────
--  The stream endpoint re-resolves the token every 2 seconds per viewer.
--  `token_hash` is already UNIQUE so that lookup is indexed; this index is
--  for the MESSAGE query that follows it, which walks one conversation in
--  (created_at, id) order and needs a cursor.
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at, id);
