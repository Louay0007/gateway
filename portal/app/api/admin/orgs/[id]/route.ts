/**
 * GET /api/admin/orgs/[id] — the operator's drill-down.
 *
 * STAFF ONLY (`requireStaff('read_only')`). Everything here is a READ:
 * members, keys, subscriptions, credit notes, D17 payments and the
 * audit trail for one account. It is deliberately the lowest gate —
 * `read_only` exists precisely so a support analyst can investigate a
 * customer's complaint without being able to change anything about it.
 *
 * 404 for an org that does not exist OR is soft-deleted, identically.
 * A deleted org's ledger is retained (it is the billing record) but it
 * must not be reachable from the console: an operator seeing one listed
 * would reasonably try to re-suspend it.
 *
 * KEY MATERIAL: only `key_prefix` is returned. `key_hash` is never
 * selected in the query at all, so it cannot leak through this response
 * even if the projection were changed by mistake later.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { adminOrgDetail } from '@/lib/admin/orgs';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireStaff('read_only');
    const { id } = await params;
    // Checked before the query, not after: a malformed uuid would make
    // postgres raise 22P02, which surfaces as a 500 rather than the 404
    // the caller deserves.
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const detail = await adminOrgDetail(id);
    if (!detail) return jsonError('not_found', 'No such organization.');

    return Response.json(detail);
  } catch (e) {
    return errorResponse(e);
  }
}