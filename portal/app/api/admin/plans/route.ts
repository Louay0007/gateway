/**
 * /api/admin/plans — GET the catalog, POST create a plan.
 *
 * STAFF ONLY. GET is `read_only`; POST and every write under
 * `/api/admin/plans/[id]` require `owner`.
 *
 * `owner` and not `admin` because a plan is the shape of the business:
 * its price, its rate multiplier and its hard cap decide what every
 * customer pays and how much of it is margin. `admin` can move money on
 * ONE account; changing a plan moves money for every account on it.
 *
 * The caller never sends `overageMarkupBps`. It is derived from
 * `rateMultiplierBps − 10000` on every write, because that identity is
 * an enforced invariant (HANDOFF.md §5.14) and exposing both fields
 * would let an operator set a multiplier and a markup that disagree —
 * a silent invoicing bug that fails nothing and is wrong everywhere.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { createPlan, listPlansAdmin } from '@/lib/admin/plans';
import { firstIssue, planBodySchema } from '@/lib/admin/plan-schema';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireStaff('read_only');
    const rows = await listPlansAdmin();
    return Response.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request): Promise<Response> {
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
    const result = await createPlan(staff.id, parsed.data);
    if (!result.ok) {
      return jsonError(
        result.error === 'not_found' ? 'not_found'
        : result.error === 'conflict' ? 'conflict'
        : 'validation',
        result.message,
      );
    }
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}