/**
 * POST /api/admin/orgs/[id]/sync — re-push an org's entitlement now.
 *
 * STAFF ONLY, role `support`. The hourly reconcile job retries failed
 * pushes on its own; this is the "answer the customer in front of you"
 * path. It calls the SAME idempotent sync, so it cannot double-apply.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { retryEntitlementSync } from '@/lib/billing/admin-console';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('support');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await retryEntitlementSync(staff.id, id);
    if (!result.ok) return jsonError('not_found', 'No such organization.');
    return Response.json({
      ok: true,
      syncOk: result.syncOk ?? null,
      syncError: result.syncError ?? null,
      effect: result.effect ?? null,
      keysSynced: result.keysSynced ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
