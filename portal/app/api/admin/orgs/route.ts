/**
 * GET /api/admin/orgs — the admin console's org list.
 *
 * STAFF ONLY (`requireStaff('support')`). This is the widest read in the
 * product — every customer org, its plan, its gateway state and its
 * period spend — so the gate is deliberate and checked before any query.
 *
 * Upgraded from a hard `LIMIT 200` to a filtered, paginated roster. The
 * original returned the newest 200 orgs and nothing else, which is
 * correct for an empty database and useless at 200 accounts: there was
 * no way to search, no way to find the one org a customer just named,
 * and no way to see that `total` was a lie.
 *
 * `over_cap_only` is the filter that needs the period spend computed
 * before comparison, so it takes a separate code path in the service —
 * see `listOverCap`.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listAdminOrgsFiltered } from '@/lib/admin/orgs';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['active', 'suspended', 'deleted'] as const;
const BOOLS = { true: true, false: false } as const;

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');
    const sp = new URL(request.url).searchParams;

    const status = sp.get('status');
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return jsonError('validation', `status must be one of: ${STATUSES.join(', ')}.`);
    }

    const overCap = sp.get('over_cap');
    if (overCap && !(overCap in BOOLS)) {
      return jsonError('validation', 'over_cap must be "true" or "false".');
    }

    const page = sp.get('page');
    const pageSize = sp.get('page_size');
    const parsedPage = page ? Number(page) : 1;
    const parsedSize = pageSize ? Number(pageSize) : 25;
    if (!Number.isFinite(parsedPage) || parsedPage < 1) {
      return jsonError('validation', 'page must be a positive whole number.');
    }
    if (!Number.isFinite(parsedSize) || parsedSize < 1 || parsedSize > 100) {
      return jsonError('validation', 'page_size must be between 1 and 100.');
    }

    const result = await listAdminOrgsFiltered({
      q: sp.get('q') ?? undefined,
      status: status as (typeof STATUSES)[number] | undefined,
      planCode: sp.get('plan') ?? undefined,
      entitlementFailed:
        sp.get('entitlement_failed') === null
          ? undefined
          : sp.get('entitlement_failed') === 'true',
      overCapOnly:
        overCap === null ? undefined : overCap === 'true',
      page: parsedPage,
      pageSize: parsedSize,
    });

    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}