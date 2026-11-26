/**
 * GET /api/admin/customers/[id] — one person, across every org they belong to.
 *
 * STAFF ONLY, `support`. Read-only: every action on this person's ACCOUNTS
 * goes through the org routes, where the audit row and the gateway push
 * already live. Nothing here writes.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { customerDetail } from '@/lib/admin/customers';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireStaff('support');

    const { id } = await params;
    // A malformed id is 404, never a cast error: it must not reach Postgres
    // as a 500 oracle, and it must not be distinguishable from a bad one.
    if (!UUID.test(id)) return jsonError('not_found', 'No such customer.');

    const detail = await customerDetail(id);
    if (!detail) return jsonError('not_found', 'No such customer.');

    return Response.json(detail);
  } catch (e) {
    return errorResponse(e);
  }
}
