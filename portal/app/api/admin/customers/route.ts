/**
 * GET /api/admin/customers — search people by email or name.
 *
 * STAFF ONLY, `support`. The first console route that starts at `users`
 * rather than `organizations`: the drill-down has always been reachable only
 * by org id, so "jane@acme.com emailed us" had no route in the product.
 *
 * `support` rather than `read_only` to match the org roster, which is the
 * widest read in the console.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { searchCustomers } from '@/lib/admin/customers';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');

    const sp = new URL(request.url).searchParams;
    const page = Number(sp.get('page') ?? '1');
    const pageSize = Number(sp.get('page_size') ?? '25');

    if (!Number.isFinite(page) || page < 1) {
      return jsonError('validation', 'page must be a positive whole number.');
    }
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      return jsonError('validation', 'page_size must be between 1 and 100.');
    }

    const result = await searchCustomers({
      q: sp.get('q') ?? undefined,
      onlyUnverified: sp.get('unverified') === '1',
      onlyWithoutOrg: sp.get('no_org') === '1',
      page,
      pageSize,
    });

    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
