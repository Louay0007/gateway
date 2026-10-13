-- ═══════════════════════════════════════════════════════════════════════
--  0006_account_operations.sql — profile, password, and session invalidation
--
--  Backs three capabilities the UI asserted but the backend never had:
--  editing your own name, changing your password while signed in, and
--  deleting your account.
--
--  password_changed_at is the important one, and it is not decoration.
--
--  Auth.js v5 permits the Credentials provider ONLY with the JWT session
--  strategy (auth.ts), so a session is a self-contained token: deleting a
--  row cannot revoke a cookie that was copied beforehand. The consequence
--  was documented as a known limit in lib/auth/reset.ts and
--  lib/auth/actions.ts — "a copied session lives at most maxAge (7
--  days)" — and it was acceptable while the ONLY way to change a
--  password was the emailed reset link, which a requester already proved
--  control of the inbox.
--
--  Adding a signed-in password change makes that limit a live hole: a
--  customer who changes their password because they think it was stolen
--  expects the attacker's cookie to die, and it would not.
--
--  The fix is a freshness check, not a session store:
--
--    1. `password_changed_at` is stamped on every credential change
--       (password change AND password reset).
--    2. Auth.js copies it into the JWT at sign-in (auth.ts).
--    3. lib/auth/authorize.ts compares the token's copy against the row
--       on EVERY authenticated request and rejects a mismatch.
--
--  A token minted before the change carries the old stamp, so it is
--  rejected — including one an attacker copied a week ago. This is
--  strictly stronger than deleting a session row, because it cannot be
--  sidestepped by a token that was never in the table.
--
--  DEFAULT now() rather than NULL: every existing account gets a stamp at
--  migration time, and any token issued before the migration carries no
--  stamp in its JWT, which the comparison treats as "older than anything"
--  → those sessions are invalidated once. Everyone signs in again. That is
--  the correct outcome for a credential-store migration.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

UPDATE users
   SET password_changed_at = now()
 WHERE password_changed_at IS NULL;

ALTER TABLE users
  ALTER COLUMN password_changed_at SET DEFAULT now(),
  ALTER COLUMN password_changed_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_changed_at_idx
  ON users (password_changed_at);