/**
 * Console credentials — verify by USERNAME, not email.
 *
 * The console used to be reached through the customer sign-in form, so a
 * staff operator typed a full email address and received a cookie identical
 * to a customer's. This module is the whole credential side of the fix
 * (migration 0053): a username, and a password hash in its own table.
 *
 * The only place a staff password is read. Everything else in the console
 * works from a session or from a `staff_users` row.
 *
 * NO `next/navigation`, no `@/auth` — so `scripts/create-accounts.ts` and
 * the proof runner can import it. Same constraint that pulled `AuthzError`
 * out of `authorize.ts`.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password';

export interface ConsoleIdentity {
  staffUserId: string;
  username: string;
  role: string;
  name: string | null;
  revokedAt: Date | null;
  passwordChangedAt: Date;
}

/**
 * Resolve a username to its staff row, or null.
 *
 * Case-insensitive on `lower(username)`, which is the SAME expression the
 * unique index in 0053 is built on: a lookup and the constraint can never
 * disagree about whether two rows collide.
 *
 * Returns a revoked row rather than null, deliberately. The caller needs to
 * know the account exists in order to run the KDF and keep the timing
 * profile flat; "revoked" must not be cheaper to answer than "wrong
 * password".
 */
export async function staffByUsername(username: string): Promise<ConsoleIdentity | null> {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;

  const rows = (await db.execute(sql`
    SELECT s.id::text AS staff_user_id, s.username, s.role::text AS role, s.name,
           s.revoked_at, c.password_changed_at
      FROM staff_users s
      JOIN staff_credentials c ON c.staff_user_id = s.id
     WHERE lower(s.username) = ${normalized}
     LIMIT 1
  `)) as unknown as {
    staff_user_id: string;
    username: string;
    role: string;
    name: string | null;
    revoked_at: Date | string | null;
    password_changed_at: Date | string;
  }[];

  const r = rows[0];
  if (!r) return null;

  return {
    staffUserId: r.staff_user_id,
    username: r.username,
    role: r.role,
    name: r.name,
    revokedAt: r.revoked_at == null ? null : new Date(r.revoked_at),
    passwordChangedAt: new Date(r.password_changed_at),
  };
}

/**
 * Verify a console password against the stored scrypt hash.
 *
 * The KDF runs even when the row is missing — `verifyPassword` documents
 * why — so an unknown username and a wrong password cost the same.
 *
 * Rehash-on-login, exactly as `auth.ts` does for customers: raising the
 * cost parameters later is a rolling upgrade, not a flag-day migration.
 */
export async function verifyStaffPassword(
  staffUserId: string,
  password: string,
): Promise<{ ok: boolean }> {
  const rows = (await db.execute(sql`
    SELECT password FROM staff_credentials WHERE staff_user_id = ${staffUserId}::uuid
  `)) as unknown as { password: string }[];

  const stored = rows[0]?.password;
  const ok = await verifyPassword(password, stored);
  if (!ok) return { ok: false };

  if (stored && needsRehash(stored)) {
    const upgraded = await hashPassword(password);
    await db.execute(sql`
      UPDATE staff_credentials
         SET password = ${upgraded}, updated_at = now()
       WHERE staff_user_id = ${staffUserId}::uuid
    `);
  }

  return { ok: true };
}

/**
 * Does this operator have a console login at all?
 *
 * Used by the roster so an owner can see which rows still need a credential:
 * granting ACCESS (a staff_users row) and issuing a CREDENTIAL are two
 * different actions, and only the second one lets someone sign in.
 */
export async function hasConsoleCredential(staffUserId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 FROM staff_credentials WHERE staff_user_id = ${staffUserId}::uuid LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * Set or reset a console password. Used by the seed script and the CLI —
 * never by a route, because the KDF parameters must match
 * lib/auth/password.ts exactly and a form would mean a second copy.
 *
 * Writes `password_changed_at`, which is what invalidates console cookies
 * already issued: a JWT cannot be revoked by deleting a row, so the stamp
 * is the revocation mechanism.
 */
export async function setStaffPassword(
  staffUserId: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await db.execute(sql`
    INSERT INTO staff_credentials (staff_user_id, password, password_changed_at, updated_at)
    VALUES (${staffUserId}::uuid, ${hash}, now(), now())
    ON CONFLICT (staff_user_id) DO UPDATE
       SET password = ${hash}, password_changed_at = now(), updated_at = now()
  `);
}
