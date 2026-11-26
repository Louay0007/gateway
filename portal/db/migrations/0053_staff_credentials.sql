-- ════════════════════════════════════════════════════════════════════════
--  0053_staff_credentials.sql — a console login that names a person
--
--  WHY NOT REUSE auth_users. Staff sign-in went through the customer form at
--  /sign-in, which meant an operator typed a full email address to reach a
--  staff console, and the console session was byte-for-byte a customer
--  session — same cookie name, same derived key. A compromised console
--  cookie was therefore a portal credential.
--
--  WHY THE HASH IS NOT A COLUMN ON staff_users. `requireStaff()` reads
--  staff_users on EVERY authenticated request (lib/auth/staff-session.ts) to
--  resolve a rank. Adding `password` there would select a scrypt hash into
--  memory on every console page render, every nav click and every API call,
--  for a value read on exactly one path: the login. Identity and secret are
--  split for the same reason `users` and `auth_credentials` already are.
--
--  WHY username IS NULLABLE, NOT NOT NULL. Existing rows have no username
--  and none can be invented for them (two staff could share a local-part).
--  They simply cannot log in to the console until an owner grants one —
--  a loud, recoverable state, unlike a migration that fails and takes the
--  console down on deploy.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS username TEXT;

-- Case-insensitive uniqueness. A UNIQUE on the raw column would let "Zaino"
-- and "zaino" coexist, which is the classic lookalike-account bug: an owner
-- grants access to one and the other logs in.
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_username_lower_idx
  ON staff_users (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_credentials (
  staff_user_id       UUID PRIMARY KEY REFERENCES staff_users(id) ON DELETE RESTRICT,
  -- Self-describing scrypt string, identical in format to
  -- auth_credentials.password (lib/auth/password.ts). Same KDF, same verify
  -- function: a second hashing scheme is a second bug.
  password            TEXT NOT NULL,
  -- What the console session's freshness check compares against, exactly as
  -- users.password_changed_at does for the portal. A password change must
  -- invalidate cookies already issued, and a JWT cannot be revoked by
  -- deleting a row.
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RESTRICT, not CASCADE: deleting a staff row must not silently take the
-- evidence with it (credit_notes.created_by names it).

COMMENT ON TABLE staff_credentials IS
  'Console password material. One row per staff_users row that can log in.';
COMMENT ON COLUMN staff_credentials.password_changed_at IS
  'Copied into the session JWT at sign-in; a mismatch revokes the cookie.';
