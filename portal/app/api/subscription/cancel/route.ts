/**
 * POST /api/subscription/cancel — stop the subscription (owner only).
 *
 * Body: { atPeriodEnd?: boolean }.
 *
 *   immediate    — access is cut now through the entitlement sync (the
 *                  budget becomes CUT_BUDGET, so the next request gets
 *                  a clean 429 — PLATFORM.md §5.1's "do not revoke
 *                  keys, starve them" rule). Keys stay live so
 *                  re-subscribing is instant.
 *   atPeriodEnd  — the kind cancel: access continues until the paid
 *                  period ends, and `expire_subscriptions` cuts it then.
 *
 * If the provider's cancellation call failed, the response carries
 * `providerError` so the UI can say so — billing still needs a human on
 * that one.
 */

import { z } from 'zod';
import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { cancelSubscription } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  atPeriodEnd: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is the default (immediate cancel), not an error.
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const ctx = await requireActiveOrg();
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can cancel the subscription.');
    }

    const result = await cancelSubscription(ctx.orgId, ctx.userId, {
      atPeriodEnd: parsed.data.atPeriodEnd ?? false,
    });
    return Response.json({
      state: result.atPeriodEnd ? 'cancel_scheduled' : 'canceled',
      ...result,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
