/**
 * POST /api/admin/orgs/[id]/subscription/remove — stop service NOW.
 *
 * STAFF ONLY, role `owner`. This ends a paying customer's access before the
 * period they paid for has finished, which is a heavier act than a cancel —
 * the same tier as editing the plan catalog, for the same reason: it changes
 * what we owe someone.
 *
 * NOT A DELETE. `payments_d17.subscription_id` cascades, so deleting the row
 * would take the payment history with it. The subscription is marked
 * `canceled`, three columns record who/why, and the entitlement sync cuts the
 * account at the gateway (see migration 0055).
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { adminRemoveSubscription } from '@/lib/admin/subscriptions';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reason is required for every removal — the service enforces it too. */
const schema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for the removal.').max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'A reason is required.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'A reason is required.');
  }

  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await adminRemoveSubscription(staff.id, id, { reason: parsed.data.reason });

    if (!result.ok) {
      const code =
        result.error === 'not_found' || result.error === 'no_subscription'
          ? 'not_found'
          : result.error === 'reason_required'
            ? 'validation'
            : 'conflict';
      return jsonError(code, result.message);
    }

    return Response.json({
      ok: true,
      effect: result.effect,
      syncOk: result.syncOk,
      syncError: result.syncError,
      currentPeriodEnd: result.currentPeriodEnd ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
