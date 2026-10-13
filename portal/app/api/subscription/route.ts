/**
 * GET /api/subscription — the dashboard bundle (C-07 backend).
 *
 * One payload answers every question the dashboard asks: which plan am
 * I on, is it live, what are my limits, what have I used this period,
 * how many keys do I have left. All usage numbers are aggregated from
 * `usage_records` here — the ledger, not the rollup cache
 * (PLATFORM.md §8.2).
 */

import { requireActiveOrg } from '@/lib/auth/authorize';
import { subscriptionBundle } from '@/lib/billing';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const bundle = await subscriptionBundle(ctx.orgId);
    return Response.json(bundle);
  } catch (e) {
    return errorResponse(e);
  }
}
