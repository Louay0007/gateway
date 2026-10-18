/**
 * GET /api/admin/financials — revenue, margin and the subscription base.
 *
 * STAFF ONLY, `read_only`. A pure read of the ledger and the
 * subscription table; nothing here writes, and no customer-visible
 * number is derived from it.
 *
 * Returns the four revenue concepts SEPARATELY (collected, recognised
 * MRR, usage revenue, upstream cost) rather than one blended "revenue"
 * figure — see the header of `lib/admin/financials.ts` for why they
 * legitimately disagree and why collapsing them is the bug this endpoint
 * exists to prevent.
 *
 * `window_days` is bounded to 1–365 server-side. The series builds one
 * row per day via `generate_series`, so an unbounded window would let a
 * caller ask for a million rows.
 */

import { requireStaff } from '@/lib/auth/authorize';
import {
  financialSeries,
  financialSummary,
  mrrByPlan,
} from '@/lib/admin/financials';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('read_only');

    const sp = new URL(request.url).searchParams;
    const raw = sp.get('window_days');
    const windowDays = raw === null ? 30 : Number(raw);
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 365) {
      return jsonError('validation', 'window_days must be between 1 and 365.');
    }

    const [summary, series, mrr] = await Promise.all([
      financialSummary(windowDays),
      financialSeries(windowDays),
      mrrByPlan(),
    ]);

    return Response.json({ summary, series, mrr });
  } catch (e) {
    return errorResponse(e);
  }
}