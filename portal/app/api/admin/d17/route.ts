/**
 * GET /api/admin/d17 — the manual-payment verification queue.
 *
 * THE MISSING ADMIN SURFACE. `listD17Queue`, `approveD17Payment` and
 * `rejectD17Payment` (411 lines in lib/billing/d17-admin.ts, all proven by
 * `make verify-d17`) had no route handler: they were only reachable from
 * a `'use server'` action and a page that were deleted with the old
 * frontend. The service existed, the two routes that survived (CSV export,
 * screenshot) existed, and nothing existed that could actually approve a
 * payment.
 *
 * Gate: `staff('support')`. Screenshot viewing is `read_only` (evidence
 * is read-only), approving hands a customer paid access, which is support
 * desk work — not an owner action.
 *
 * Statuses default to the states an operator works through. `paid` is
 * included so a shift can see what they just approved; `pending_payment`
 * is excluded because nobody has claimed to have paid yet.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listD17Queue } from '@/lib/billing/d17-admin';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_STATUSES = ['proof_submitted', 'rejected', 'paid', 'expired'];

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');

    const raw = new URL(request.url).searchParams.get('status');
    const statuses =
      raw === null
        ? DEFAULT_STATUSES
        : raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10);

    if (statuses.length === 0) {
      return jsonError('validation', 'Provide at least one status, or omit the parameter.');
    }

    const rows = await listD17Queue(statuses);
    return Response.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}