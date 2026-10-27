/**
 * POST /api/admin/orgs/[id]/grant-plan — put an org on a catalog plan by
 * hand, with no provider involved.
 *
 * STAFF ONLY, role `admin` (same tier as suspension and credit notes: it
 * hands out paid service, so it is not a support-tier action).
 *
 * The body is `{ planCode }` and nothing else. The period is COMPUTED
 * server-side from the plan's interval (`periodFor`), never accepted from
 * the client: a caller who could name the end date could grant ten years,
 * and the audit row would look perfectly ordinary.
 *
 * A sync failure is reported in the body, not as a 5xx. The subscription
 * row is committed at that point, so answering 500 would tell the operator
 * nothing happened when something did — see `lib/admin/subscriptions.ts`.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { grantPlan } from '@/lib/admin/subscriptions';
import { grantPlanBodySchema } from '@/lib/admin/grant-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  not_found: 'No such organization.',
  deleted: 'That account is deleted. It cannot be granted a plan.',
  plan_not_found: 'That plan no longer exists. Reload and try again.',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Choose a plan.');
  }

  const parsed = grantPlanBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Choose a plan.',
    );
  }

  try {
    const staff = await requireStaff('admin');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await grantPlan(staff.id, id, parsed.data.planCode);
    if (!result.ok) {
      const code = result.error === 'plan_not_found' ? 'validation' : 'not_found';
      return jsonError(code, MESSAGES[result.error] ?? 'That plan could not be granted.');
    }

    return Response.json({
      ok: true,
      planCode: result.planCode,
      planName: result.planName,
      interval: result.interval,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      previousPlanCode: result.previousPlanCode,
      previousStatus: result.previousStatus,
      syncOk: result.syncOk,
      syncError: result.syncError,
      effect: result.effect,
      keysSynced: result.keysSynced,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
