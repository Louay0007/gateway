/**
 * POST /api/admin/orgs/[id]/reactivate — lift a suspension.
 *
 * STAFF ONLY, role `admin`. Re-pushes the org's plan entitlements through
 * the same sync a subscription change uses, so reactivation restores the
 * plan's real limits (or the correct cut, if the subscription itself is no
 * longer live — a reactivated org does not get access it did not pay for).
 */

import { requireStaff } from '@/lib/auth/authorize';
import { setOrganizationStatus } from '@/lib/billing/admin-console';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('admin');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await setOrganizationStatus(staff.id, id, 'active');
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
