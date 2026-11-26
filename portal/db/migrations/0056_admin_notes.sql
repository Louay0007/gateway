-- ══════════════════════════════════════════════════════════════════════════
--  0056_admin_notes.sql — what the last operator learned
--
--  WHY A TABLE AND NOT audit_log.
--
--  The audit trail answers "what changed, and who changed it" — append-only,
--  structured, and read through a filter. It cannot hold "called the
--  customer, they paid cash at the post office, approved manually" without
--  turning a machine-readable trail into a free-text log that the audit
--  screen's prefix filters can no longer reason about.
--
--  Notes are for the human next in the queue; the audit row is for the
--  record. Both exist, and they are different things.
--
--  WHY ON THE ORGANIZATION, not the user: every action this console takes is
--  on an org, so a note pinned to the org is where the next operator looks.
--  A note on a person is a reasonable later refinement, not the first cut.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- staff_users.id of the author. ON DELETE RESTRICT, matching every other
  -- place a staff id is recorded: a note must keep resolving to a person,
  -- and staff rows are revoked rather than deleted for exactly this reason.
  author_id       UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  -- Denormalised so the note still reads correctly if a username is later
  -- changed — the note records who wrote it AT THE TIME.
  author_username TEXT NOT NULL,

  body            TEXT NOT NULL,
  -- 'note' | 'payment' | 'subscription' | 'abuse'. A filter, not a taxonomy
  -- anybody has to get right on day one: unknown values render as 'note'.
  kind            TEXT NOT NULL DEFAULT 'note',
  -- Pinned notes sort above the timeline on the drill-down.
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A note is a sentence, not an essay. Bounded so one paste cannot bloat
  -- the row the drill-down selects on every render.
  CONSTRAINT admin_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS admin_notes_org_idx
  ON admin_notes (organization_id, created_at DESC);

COMMENT ON TABLE admin_notes IS
  'Free-text operator notes on an account. Not the audit trail — see the 0056 header for why both exist.';
