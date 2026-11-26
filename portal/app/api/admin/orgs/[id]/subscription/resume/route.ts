/**
 * POST /api/admin/orgs/[id]/subscription/resume — undo a scheduled cancel.
 *
 * STAFF ONLY, role `admin`. Delegates to `resumeSubscription()` — the
 * customer's own path — and records a separate audit action because the actor
 * differs in kind.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { adminResumeSubscription } from '@/lib/admin/subscriptions';
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

    const result = await adminResumeSubscription(staff.id, id);

    if (!result.ok) {
      const code =
        result.error === 'not_found' || result.error === 'no_subscription'
          ? 'not_found'
          : 'conflict';
      return jsonError(code, result.message);
    }

    return Response.json({
      ok: true,
      atPeriodEnd: false,
      currentPeriodEnd: result.currentPeriodEnd ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
