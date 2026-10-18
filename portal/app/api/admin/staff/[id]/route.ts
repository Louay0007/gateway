/**
 * /api/admin/staff/[id] — PATCH a role, DELETE (revoke) access.
 *
 * STAFF ONLY, `owner` for both. Same reasoning as the grant: these
 * change who can reach the console at all.
 *
 * THERE IS NO REAL DELETE. The handler is named DELETE because that is
 * the honest HTTP verb for "withdraw this person's access", but it
 * writes `revoked_at` and leaves the row. Deleting would leave
 * `credit_notes.created_by` and `audit_log.actor_id` pointing at an id
 * that no longer exists — destroying the evidence of who moved money.
 * A revoked operator stays in the roster forever, and `requireStaff`
 * refuses them on the very next request.
 *
 * SELF-EDIT AND LAST-OWNER ARE REFUSED IN THE SERVICE, not here, because
 * the rules depend on database state (is this the only owner?) that the
 * route cannot see.
 */

import { z } from 'zod';
import { requireStaff } from '@/lib/auth/authorize';
import { isStaffRole, STAFF_ROLES } from '@/lib/auth/staff-roles';
import { revokeStaffAccess, setStaffRole } from '@/lib/admin/staff';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  role: z.string().refine(isStaffRole, `Role must be one of: ${STAFF_ROLES.join(', ')}.`),
});

/** Maps a service refusal to a status. `conflict` is the honest code for
 *  "the last owner" — the request is well-formed, the state forbids it. */
function refusal(error: string, message: string): Response {
  const code =
    error === 'not_found' ? 'not_found'
    : error === 'validation' ? 'validation'
    : 'conflict';
  return jsonError(code, message);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such staff account.');

    const result = await setStaffRole(staff.id, id, parsed.data.role);
    if (!result.ok) return refusal(result.error, result.message);
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such staff account.');

    const result = await revokeStaffAccess(staff.id, id);
    if (!result.ok) return refusal(result.error, result.message);
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}