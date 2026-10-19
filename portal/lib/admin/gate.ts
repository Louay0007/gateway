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
 *   - Secret set → the request must carry EITHER a valid gate cookie OR a
 *     staff session at the required role. The gate code and the staff
 *     login are independent credentials; holding either one is sufficient.
 *     The gate alone never GRANTS a role — `requireGateOrStaff('support')`
 *     still returns null when there is no staff session, and callers that
 *     need the role for anything beyond the boolean must still call
 *     `requireStaff()` themselves.
 */

import { cookies } from 'next/headers';
import crypto from 'node:crypto';

import { currentStaffRole } from '@/lib/auth/authorize';
import type { StaffRole } from '@/lib/auth/staff-roles';

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
