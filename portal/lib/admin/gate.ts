/**
 * Authorise a state-changing console action. Returns the actor ID to record.
 *
 * WHAT USED TO BE HERE. This module was the `admin_gate` cookie verifier —
 * a shared secret (`ADMIN_GATE_SECRET`) minted as an HMAC of a constant,
 * verified in three separate copies, and treated as a credential that could
 * approve money. It was removed with the console login (0053), because a
 * shared code is the wrong shape for that job:
 *
 *   - it names nobody, so `audit_log` recorded the opaque `gate-operator`
 *     for a payment approval and could not answer "who approved this";
 *   - it cannot be revoked per operator — only by rotating the secret for
 *     everybody;
 *   - one leaked string was the entire company's console, and the string in
 *     the shipped .env.example was `zainadmin`.
 *
 * A `staff_users` row plus its `staff_credentials` password is a credential
 * that names a person, can be revoked on its own, and writes a real actor
 * into every audit row. That is why the gate is gone rather than kept as a
 * second factor: two credentials for one job, one of which is unauditable,
 * is worse than one credential that is.
 */

import { AuthzError } from '@/lib/auth/errors';
import { staffAtLeast, type StaffRole } from '@/lib/auth/staff-roles';
import { currentStaffSession } from '@/lib/auth/staff-session';

/**
 * Authorize a STATE-CHANGING admin action. Returns the actor ID to record.
 *
 *   - no console session               → 401
 *   - session below `required`         → 403 (a `read_only` operator must not
 *                                        approve money movements just because
 *                                        they are signed in)
 *   - session at or above `required`   → their staff_users.id
 *
 * The returned id is what `appendAudit` writes as `actorId`, so a money
 * movement always names a person — the property the gate could not provide.
 */
export async function requireOperator(required: StaffRole): Promise<string> {
  const session = await currentStaffSession();
  if (!session) {
    throw new AuthzError('Sign in to the operations console', 'unauthorized', 401);
  }
  if (!staffAtLeast(session.role, required)) {
    throw new AuthzError(`Staff role '${required}' or higher is required`, 'forbidden', 403);
  }
  return session.staffUserId;
}
