/**
 * Admin gate check — the ONE verifier for the `admin_gate` cookie.
 *
 * Three places used to verify this cookie with their own copy of the
 * HMAC comparison: `app/admin/page.tsx`, `app/admin/layout.tsx`, and
 * implicitly every API route that did not check it at all. Three copies
 * of a security comparison is how one of them drifts — a different hash
 * input, a non-constant-time compare, a `return true` where it should be
 * `false` — and the drift is invisible until it is an incident.
 *
 * This module is the single implementation. The two page-level copies
 * remain where they are (a layout and a page cannot import a helper that
 * pulls in route-only modules — and this one does not, so they could, but
 * moving them is churn with no behavior change), and every API route that
 * must honor the gate calls `requireGateOrStaff()` from here.
 *
 * The rule, stated once:
 *   - Secret unset → the gate is DISABLED, every check passes. This is the
 *     dev/self-host posture, and it is explicit: `gatePassed()` returning
 *     true on an unset secret is "no gate installed", never "gate locked".
 *   - Secret set → the request must carry a valid gate cookie to see the
 *     login form, AND a staff session to see or change anything.
 *   - Rank is always taken from `staff_users`, never from the gate. The
 *     gate proves only "someone knows the code"; it names nobody, so it
 *     authorizes no action and no data.
 */

import { cookies } from 'next/headers';
import crypto from 'node:crypto';

import { currentStaffRole } from '@/lib/auth/authorize';
import { AuthzError } from '@/lib/auth/errors';
import { staffAtLeast, type StaffRole } from '@/lib/auth/staff-roles';

export const ADMIN_GATE_COOKIE = 'admin_gate';

function expectedCookieValue(secret: string): string {
  return crypto.createHmac('sha256', secret).update(ADMIN_GATE_COOKIE).digest('hex');
}

/** True when the request carries a gate cookie matching the server secret. */
export async function gateCookieValid(): Promise<boolean> {
  const secret = process.env.ADMIN_GATE_SECRET;
  if (!secret) return true; // gate disabled when no secret is set
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_GATE_COOKIE)?.value;
  if (!value) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expectedCookieValue(secret)));
  } catch {
    return false;
  }
}

/** Placeholder actor ID for gate-only operators in audit logs and DB rows. */
export const GATE_ACTOR_ID = 'gate-operator';

/**
 * Gate-or-staff check for admin API routes.
 *
 * Returns the staff role when the caller holds a staff session (possibly
 * null — gate-only callers have no role), and throws nothing. Callers
 * decide what to do with the two facts:
 *   - `gateOk === false` → 401/redirect, no credential at all.
 *   - `gateOk === true, role === null` → gate-only operator: read-only
 *     evidence is fine, state-changing actions are not.
 *   - `gateOk === true, role` → full staff path, rank-checked by the caller.
 */
export async function requireGateOrStaff(): Promise<{
  gateOk: boolean;
  role: StaffRole | null;
}> {
  const [gateOk, role] = await Promise.all([gateCookieValid(), currentStaffRole()]);
  return { gateOk, role };
}

/**
 * Authorize a STATE-CHANGING admin action. Returns the actor ID to record.
 *
 *   - no gate cookie and no staff session → 401.
 *   - staff session below `required` → 403 (a `read_only` account must not
 *     approve money movements just because it is signed in).
 *   - staff session at or above `required` → their user ID.
 *   - gate cookie only → 403.
 *
 * THE GATE COOKIE USED TO PASS EVERY RANK CHECK HERE. The reasoning was
 * "the shared secret is this deployment's full-trust credential", which
 * holds only while the secret is held by one person. It is not a rank: it
 * carries no identity, cannot be revoked per operator, and is written
 * into `audit_log` as the opaque `GATE_ACTOR_ID`. Anyone who learned the
 * string could approve D17 payments — real money — with an audit trail
 * naming nobody.
 *
 * The gate is a PRE-AUTH step that reveals the login form, not a
 * credential that moves money. State changes need a staff row.
 */
export async function requireOperator(required: StaffRole): Promise<string> {
  const { gateOk, role } = await requireGateOrStaff();
  if (!gateOk && role === null) {
    throw new AuthzError('Not signed in', 'unauthorized', 401);
  }
  if (role === null) {
    throw new AuthzError('Sign in with a staff account to make changes', 'forbidden', 403);
  }
  if (!staffAtLeast(role, required)) {
    throw new AuthzError(`Staff role '${required}' or higher is required`, 'forbidden', 403);
  }
  const actorId = await currentStaffUserId();
  if (!actorId) {
    // A staff session whose token carries no id cannot be attributed. An
    // unattributable money movement is worse than a refused one.
    throw new AuthzError('Session is missing a user id — sign in again', 'unauthorized', 401);
  }
  return actorId;
}

/** The signed-in user's ID, or null when the session carries none. */
async function currentStaffUserId(): Promise<string | null> {
  const { auth } = await import('@/auth');
  const session = await auth();
  return session?.user?.id ?? null;
}
