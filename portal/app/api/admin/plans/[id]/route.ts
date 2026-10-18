/**
 * /api/admin/plans/[id] — PATCH a plan, DELETE retires it.
 *
 * STAFF ONLY, `owner` for both.
 *
 * DELETE DOES NOT DELETE. It sets `public = false`. The reason is
 * structural, not stylistic: `subscriptions.plan_id` is a NOT NULL
 * foreign key with no ON DELETE clause, so deleting a plan any customer
 * is on either raises an error today or — if that FK is ever relaxed —
 * orphans their subscription and silently strips their entitlements on
 * the next entitlement sync. Retiring removes the plan from `/api/plans`
 * and the pricing page while leaving every live subscription intact and
 * billable.
 *
 * The service refuses to retire a plan that still has subscribers, so a
 * paying customer cannot be left without a tier by a mistyped click.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { restorePlan, retirePlan, updatePlan } from '@/lib/admin/plans';
import { firstIssue, planBodySchema } from '@/lib/admin/plan-schema';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const parsed = planBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', firstIssue(parsed.error));
  }

  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such plan.');

    const result = await updatePlan(staff.id, id, parsed.data);
    if (!result.ok) return refusal(result.error, result.message);
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}

/** `action=restore` re-publishes a retired plan. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such plan.');

    const restore = new URL(request.url).searchParams.get('action') === 'restore';
    const result = restore
      ? await restorePlan(staff.id, id)
      : await retirePlan(staff.id, id);

    if (!result.ok) return refusal(result.error, result.message);
    return Response.json({ ok: true, id: result.id, action: restore ? 'restored' : 'retired' });
  } catch (e) {
    return errorResponse(e);
  }
}