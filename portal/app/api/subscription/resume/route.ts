/**
 * POST /api/subscription/resume — undo a pending "cancel at period end".
 *
 * The dashboard has shipped a "Resume subscription" button since the UI
 * rewrite with nothing behind it: `cancelSubscription` was the only writer
 * of `cancel_at_period_end` and only ever set it to `true`, so a customer
 * who cancelled by accident had no way back but a support ticket.
 *
 * Owner only, same as cancel and change-plan: it is a commitment change.
 *
 * A wrong guess about the account's state is a 409, not a silent success:
 * the UI must not claim a subscription is active when the server thinks it
 * is already canceled. See `resumeSubscription` for the exact guards.
 */

import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { resumeSubscription } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can resume the subscription.');
    }

    const result = await resumeSubscription(ctx.orgId, ctx.userId);
    return Response.json({ state: 'active', ...result });
  } catch (e) {
    return errorResponse(e);
  }
}