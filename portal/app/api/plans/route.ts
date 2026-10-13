/**
 * GET /api/plans — the public plan catalog.
 *
 * Feeds the pricing page and the in-dashboard chooser, so both render
 * the same numbers the entitlement sync will push. Public: no session,
 * no org-scoped data — plan rows are catalog, not tenant state.
 */

import { listPlans } from '@/lib/billing';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const plans = await listPlans();
    return Response.json({ plans });
  } catch (e) {
    return errorResponse(e);
  }
}
