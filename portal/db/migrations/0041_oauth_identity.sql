-- ══════════════════════════════════════════════════════════════════════
--  0041_oauth_identity.sql — social sign-in (Google, GitHub, Apple).
--
--  WHY. `auth_accounts` has existed since 0002 and has never held a row:
--  the repository had no OAuth provider, so the table this feature was
--  designed for sat empty. This migration adds only what is missing to use
--  it — no new identity table, no new session store.
--
--  WHAT CHANGED IN THE IDENTITY RULE. The linking policy is
--  "same provider-verified email AND no other identity already owns it"
--  (lib/auth/oauth/resolve.ts). Two schema facts are needed to enforce it
--  at the database rather than in application code:
--
--    1. a lookup by email must be cheap and case-insensitive;
--    2. a duplicate case-insensitive email must be IMPOSSIBLE, because the
--       resolve path reads then writes, and two concurrent callbacks with
--       the same address would otherwise both pass the read.
--
--  `auth_users.email` is already `UNIQUE` (0002), but that constraint is
--  case-SENSITIVE: 'Alice@x.tn' and 'alice@x.tn' are two rows to Postgres
--  and one person to the provider. Every writer in the codebase lowercases
--  first (lib/auth/create-user.ts), which is a convention, not a
--  guarantee. The unique index below makes it a guarantee.
--
--  BEFORE CREATING IT the migration lowercases what is already stored,
--  otherwise the index creation fails on a legacy mixed-case row and the
--  deploy stops. That rewrite is safe because nothing reads the original
--  casing: `users.email` is written lowercased by every path and
--  `authorize.ts` resolves by exact match on a lowercased input.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Provider metadata that is NOT a token ─────────────────────────
--  Recorded so support can answer "which GitHub account is this?" without
--  reading a token, and so §6.2 row 4 can record a linking provider's
--  address WITHOUT rewriting the account's canonical email.
--
--  `provider_email` is deliberately NOT unique: the same address at two
--  providers is normal, and one provider's account can be linked from
--  several Zaino accounts only if the policy allows it (it does not —
--  resolve.ts refuses, and this column is not what enforces that).
ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS provider_email          text,
  ADD COLUMN IF NOT EXISTS provider_email_verified boolean,
  ADD COLUMN IF NOT EXISTS provider_login          text;

COMMENT ON COLUMN auth_accounts.provider_email IS
  'The address the provider reported. Display/support only — never used for authorization. Mirrors the account''s own email only when that email IS this one (§6.2).';
COMMENT ON COLUMN auth_accounts.provider_login IS
  'Provider handle (GitHub login). Never an identifier: logins are renameable, provider_account_id is the numeric id.';

-- ── 2. Private relay + signup provenance ─────────────────────────────
--  Apple's @privaterelay.appleid.com addresses are real and verified but
--  are not a corporate domain. Flagged so support can explain delivery
--  and so no future domain-based rule silently treats them as staff.
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS email_is_private_relay boolean NOT NULL DEFAULT false;

--  Which method created the account. Support cannot answer "how did this
--  person sign up" from the current schema: `auth_credentials` presence
--  implies a password, but a linked account has both rows and the row
--  that was created FIRST is not recorded anywhere.
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS signup_method text NOT NULL DEFAULT 'password';

ALTER TABLE auth_users
  DROP CONSTRAINT IF EXISTS auth_users_signup_method_check;

ALTER TABLE auth_users
  ADD CONSTRAINT auth_users_signup_method_check
  CHECK (signup_method IN ('password', 'google', 'github', 'apple'));

COMMENT ON COLUMN auth_users.signup_method IS
  'The method that CREATED this identity. Linking a second provider does not change it.';

-- ── 3. Case-insensitive uniqueness for the linking lookup ────────────
--  Lowercase first. A row that only differs by case from another would
--  make the index creation fail; collapsing them is correct, but it can
--  only be done when no collision exists — the guard below refuses rather
--  than silently merging two identities.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(e, ', ') INTO collisions
    FROM (
      SELECT lower(email) AS e
        FROM auth_users
       GROUP BY lower(email)
      HAVING count(*) > 1
    ) dupes;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      '0041: two auth_users rows differ only by email case (%), refusing to collapse them — resolve by hand first',
      collisions;
  END IF;
END $$;

UPDATE auth_users SET email = lower(email) WHERE email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx
  ON auth_users (lower(email));

COMMENT ON INDEX auth_users_email_lower_idx IS
  'The linking lookup: at most one identity may own an address, case-insensitively. Enforced here because resolve.ts reads then inserts.';

-- ── 4. Guard: signup_method is constrained (fail closed at write) ────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT signup_method INTO bad
    FROM auth_users
   WHERE signup_method NOT IN ('password', 'google', 'github', 'apple')
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0041: auth_users.signup_method holds an unknown value: %', bad;
  END IF;
END $$;

-- ── 5. Guard: the index actually exists and is unique ────────────────
--  A earlier `CREATE INDEX` (not unique) with the same name would make
--  CREATE UNIQUE INDEX IF NOT EXISTS a no-op, leaving the race open.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename  = 'auth_users'
       AND indexname  = 'auth_users_email_lower_idx'
  ) THEN
    RAISE EXCEPTION '0041: auth_users_email_lower_idx was not created';
  END IF;
END $$;
