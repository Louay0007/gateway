/**
 * POST /api/admin/orgs/[id]/devices/[deviceId]/revoke — sign a machine out.
 *
 * STAFF ONLY, role `admin`. Same tier as revoking a key: it ends a machine's
 * access, and the thing that actually authenticates is the `zn-` key the
 * device flow minted — which this revokes alongside the approval record.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { adminRevokeDevice } from '@/lib/admin/keys';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; deviceId: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('admin');
    const { id, deviceId } = await params;

    if (!UUID.test(id) || !UUID.test(deviceId)) return jsonError('not_found', 'No such device.');

    const result = await adminRevokeDevice(staff.id, id, deviceId);

    if (!result.ok) {
      return jsonError(result.error === 'not_found' ? 'not_found' : 'conflict', result.message);
    }

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
