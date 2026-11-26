/**
 * POST /api/admin/orgs/[id]/subscription/cancel — stop renewing.
 *
 * STAFF ONLY, role `admin`. Schedules a cancel at the end of the period the
 * customer already paid for, and leaves the period live. This is the safe
 * default and the one an operator should reach for; `…/remove` is the heavier
 * act that ends service now.
 *
 * Delegates to `cancelSubscription(…, { atPeriodEnd: true })` — the customer's
 * own path — so the rules about what may be scheduled have one implementation.
 * The audit row is separate, because an OPERATOR cancelling and a customer
 * cancelling are different events.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { adminCancelSubscription } from '@/lib/admin/subscriptions';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional here: scheduling a stop is reversible with Resume. */
const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No reason is fine.
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('validation', 'Keep the reason under 500 characters.');

  try {
    const staff = await requireStaff('admin');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await adminCancelSubscription(staff.id, id, { reason: parsed.data.reason });

    if (!result.ok) {
      const code =
        result.error === 'not_found' || result.error === 'no_subscription'
          ? 'not_found'
          : 'conflict';
      return jsonError(code, result.message);
    }

    return Response.json({
      ok: true,
      atPeriodEnd: result.atPeriodEnd ?? true,
      currentPeriodEnd: result.currentPeriodEnd ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
