/**
 * GET /api/admin/usage — cross-org usage and per-org economics.
 *
 * STAFF ONLY, `read_only`.
 *
 * The customer-facing `/api/usage` CANNOT answer this question. It is
 * scoped by `requireActiveOrg()` — the caller's own org — so "which
 * accounts are burning money on `frontier`?" had no route in the entire
 * product. This is that route.
 *
 * Ordered by customer revenue, not request count. An org making 10,000
 * cheap requests is less interesting than one making 200 expensive ones,
 * and only a revenue sort surfaces that.
 *
 * `model` filters by ALIAS, never a raw upstream model name. That is not
 * a privacy nicety, it is the product's central invariant (CONTEXT.md
 * §1): no upstream model name is stored, rendered or exported anywhere
 * in a customer surface. The admin console reads the same column the
 * ledger does, so the alias is all that exists here to filter on.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { orgEconomics } from '@/lib/admin/financials';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('read_only');

    const sp = new URL(request.url).searchParams;
    const rawDays = sp.get('window_days');
    const windowDays = rawDays === null ? 30 : Number(rawDays);
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 365) {
      return jsonError('validation', 'window_days must be between 1 and 365.');
    }

    const rawLimit = sp.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return jsonError('validation', 'limit must be between 1 and 200.');
    }

    const rows = await orgEconomics(windowDays, limit);
    return Response.json({ rows, windowDays, limit });
  } catch (e) {
    return errorResponse(e);
  }
}