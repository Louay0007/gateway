/**
 * 0002_auth_local.sql — self-hosted authentication (Auth.js / NextAuth v5).
 *
 * Supersedes the Clerk approach. See PLATFORM.md §2.1 — Auth.js is the
 * documented alternative when self-hosting is mandatory, and §14 open
 * decision #2 is now answered: Auth.js.
 *
 * Design:
 *   - `auth_users` holds the Auth.js identity. It is SEPARATE from the
 *     domain `users` table, which stays the authoritative mirror for all
 *     product logic (PLATFORM.md §2.1: "Never read user profile data from
 *     the auth provider at request time"). Keeping them apart means the
 *     auth library can be replaced without a schema migration of the
 *     product.
 *   - `auth_credentials` stores the scrypt hash. Not in `auth_accounts`:
 *     that table is the adapter's shape for OAuth providers, and we have
 *     none.
 *   - Sessions are JWTs, not rows: Auth.js v5 supports the Credentials
 *     provider ONLY with the JWT strategy. `auth_sessions` is retained for
 *     adapter completeness but is not the active session store.
 *     Revocation is enforced server-side on every request by re-reading
 *     `users` / `staff_users` (lib/auth/authorize.ts) — stronger than
 *     deleting a session row, because a token copied beforehand cannot
 *     outlive the account it points at.
 *   - `auth_login_attempts` backs brute-force throttling. A self-hosted
 *     credentials provider has no upstream WAF, making this a
 *     first-class control (PLATFORM.md §9.1).
 *
 * Everything here is additive. 0001 is never edited.
 */

-- ── Auth.js identity ──────────────────────────────────────────────────
CREATE TABLE auth_users (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  email          TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMPTZ,
  image          TEXT
);

CREATE TABLE auth_accounts (
  user_id            TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,
  provider           TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token      TEXT,
  access_token       TEXT,
  expires_at         INTEGER,
  token_type         TEXT,
  scope              TEXT,
  id_token           TEXT,
  session_state      TEXT,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE auth_sessions (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

CREATE TABLE auth_verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ── Credentials (scrypt) ──────────────────────────────────────────────
-- The stored value is `scrypt$N$r$p$keylen$salt$hash`, self-describing so
-- cost parameters can be raised later and rehashed on next login.
CREATE TABLE auth_credentials (
  user_id    TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  password   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Login throttling ──────────────────────────────────────────────────
-- Buckets are `id:<email>` today. The schema is keyed generically so an
-- `ip:<addr>` bucket can be added without a migration once the edge can
-- supply a trustworthy client IP.
CREATE TABLE auth_login_attempts (
  bucket           TEXT PRIMARY KEY,
  failures         INTEGER NOT NULL DEFAULT 0,
  last_failure_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until     TIMESTAMPTZ
);
CREATE INDEX auth_login_attempts_last_idx ON auth_login_attempts (last_failure_at);

-- ── Domain mirror ─────────────────────────────────────────────────────
-- No ALTER is needed on `users`: 0001 already declares
--   CHECK (auth_provider IN ('clerk','authjs'))
-- inline, so 'authjs' is already an accepted value. 'clerk' is retained
-- for historical rows only; no new identity is ever written with it.