/**
 * POST /api/admin/orgs/[id]/suspend — freeze an abusive/fraudulent org.
 *
 * STAFF ONLY, role `admin` (this stops a paying customer's service, so it
 * is not a support-tier action). Suspension is enforced in the entitlement
 * sync: the org's status is read there and resolves to a cut, so this is a
 * real gateway change and not a flag. Idempotent — suspending an already
 * suspended org returns alreadyApplied without a second push.
 */

import { z } from 'zod';
import { requireStaff } from '@/lib/auth/authorize';
import { setOrganizationStatus } from '@/lib/billing/admin-console';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No reason is fine — the action is the record.
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', 'Reason is too long.');
  }

  try {
    const staff = await requireStaff('admin');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await setOrganizationStatus(staff.id, id, 'suspended', parsed.data.reason);
    if (!result.ok) {
      return jsonError('not_found', 'No such organization.');
    }
    return Response.json({
      ok: true,
      alreadyApplied: result.alreadyApplied ?? false,
      syncOk: result.syncOk ?? null,
      syncError: result.syncError ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
