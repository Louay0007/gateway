-- ═══════════════════════════════════════════════════════════════════════
--  0008_email_verification.sql — prove you own the address you signed up with
--
--  Until now `createLocalUser` wrote `email_verified: null` and nothing
--  ever set it. Anyone could sign up with an address they do not own, and
--  the D17 payment flow TRUSTS that address: status mail, rejections and
--  activation notices all go to it. A typo'd or forged address means a
--  paying customer never learns their payment was rejected.
--
--  The token machinery already exists (`auth_verification_tokens`, built
--  for password reset in 0006). Email verification reuses the SAME table
--  with a different identifier namespace (`verify-email:`), so there is no
--  second token system to keep secure.
--
--  Two sources, one meaning: `auth_users.email_verified` (Auth.js's own
--  column) and `users.email_verified_at` (the domain mirror, authoritative
--  for product logic per PLATFORM.md §2.1). Both are written together on
--  consumption.
--
--  GRANDFATHERING. Existing rows are stamped verified. They were created
--  before verification existed; stranding them at the paywall would lock
--  real accounts out of a product they already use. Only NEW signups start
--  unverified. On a fresh install this UPDATE matches zero rows.
--
--  FORWARD-ONLY, like every migration here. A rollback would drop a column
--  that product logic reads, so recovery is `make restore`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Grandfather: anything that predates this migration is treated as owning
-- its address. New signups are inserted NULL and must verify.
UPDATE users
   SET email_verified_at = COALESCE(email_verified_at, created_at)
 WHERE email_verified_at IS NULL;

-- Mirror onto the Auth.js identity so the two never disagree for a row
-- that existed before verification.
UPDATE auth_users
   SET email_verified = COALESCE(email_verified, now())
 WHERE email_verified IS NULL;
