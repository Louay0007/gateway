/**
 * The signed-in console operator — resolved once, then re-verified.
 *
 * `adminAuth()` (lib/auth/admin-auth.ts) proves a cookie this deployment
 * minted and has not expired. It proves NOTHING about the account: a JWT is
 * self-contained and cannot be revoked, so the role and the revocation flag
 * are re-read from `staff_users` on every request. That is what makes
 * revoking an operator take effect on their next navigation, with no
 * session to wait out.
 *
 * THE THREE-WAY SEPARATION, stated once:
 *   - a portal session opens the product, never the console;
 *   - a console session opens the console, never the product;
 *   - a `staff_users` row is the only thing that grants a RANK, and it is
 *     never read from a customer's org.
 */

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { staffCredentials, staffUsers } from '@/db/schema';
import { adminAuth } from '@/lib/auth/admin-auth';
import { AuthzError } from '@/lib/auth/errors';
import { isStaffRole, staffAtLeast, type StaffRole } from '@/lib/auth/staff-roles';
import { sessionIsFresh } from '@/lib/auth/session-freshness';
import { log } from '@/lib/log';

export interface StaffSession {
  staffUserId: string;
  username: string;
  role: StaffRole;
}

/**
 * The caller's console session, or null.
 *
 * Null for: no cookie · expired cookie · foreign cookie · no staff row ·
 * revoked row · an unknown role · a cookie minted before the last password
 * change. All seven are the same answer, because none of them is a partial
 * grant.
 *
 * ORDER IS DELIBERATE. Freshness is checked BEFORE the row read, so a stale
 * cookie is answered "sign in again" rather than "you are not staff" — the
 * same distinction `requireStaff` has always made, and the reason a revoked
 * operator gets 403 while a stale one gets 401.
 */
export async function currentStaffSession(): Promise<StaffSession | null> {
  const session = await adminAuth();
  const staff = session?.staff;
  if (!staff?.id) return null;

  const [credential] = await db
    .select({ passwordChangedAt: staffCredentials.passwordChangedAt })
    .from(staffCredentials)
    .where(eq(staffCredentials.staffUserId, staff.id))
    .limit(1);

  if (!sessionIsFresh(staff.passwordChangedAt, credential?.passwordChangedAt)) {
    log.warn('console: session predates the last password change — rejected', {
      username: staff.username,
    });
    return null;
  }

  const row = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, staff.id) });

  // Revocation is checked AFTER the row lookup so a revoked operator is
  // refused rather than told to log in again: their password is fine, their
  // ACCESS was withdrawn, and re-authenticating would loop them back here.
  if (!row || row.revokedAt) {
    if (row?.revokedAt) {
      log.warn('console: revoked staff account attempted access', {
        staffUserId: row.id,
        revokedAt: row.revokedAt.toISOString(),
      });
    }
    return null;
  }

  const role = row.role;
  if (!isStaffRole(role)) {
    // A row whose role is not in the ladder grants nothing. This cannot
    // happen while `staff_users.role` is only written by validated callers —
    // which is exactly why it is checked rather than assumed.
    log.error('console: staff row holds an unknown role', { role, staffUserId: row.id });
    return null;
  }

  return {
    staffUserId: row.id,
    username: row.username ?? staff.username,
    role,
  };
}

/**
 * The caller's staff role, or null.
 *
 * Same lookup, non-throwing — for a layout or a page that must render a
 * decision instead of an error. `requireStaff()` throws, which is right for
 * a route and wrong for a nav that should simply not appear.
 */
export async function currentStaffRole(): Promise<StaffRole | null> {
  return (await currentStaffSession())?.role ?? null;
}

/**
 * Staff access. Signature unchanged from lib/auth/authorize.ts, so all 21
 * routes and the pages keep their existing calls and their existing
 * `staff.id` usage.
 *
 * Resolved from `staff_users` — never from an org_role.
 */
export async function requireStaff(required: StaffRole = 'read_only') {
  const session = await currentStaffSession();
  if (!session) {
    // 401, not 403: "sign in" is the actionable instruction, and it is the
    // same answer for a missing cookie and a stale one.
    throw new AuthzError('Sign in to the operations console', 'unauthorized', 401);
  }
  if (!staffAtLeast(session.role, required)) {
    throw new AuthzError('Insufficient staff role', 'forbidden', 403);
  }
  // The shape existing callers read: `staff.id` is the actor recorded in
  // every audit row, so money movements always name a person.
  return { id: session.staffUserId, role: session.role, username: session.username };
}
