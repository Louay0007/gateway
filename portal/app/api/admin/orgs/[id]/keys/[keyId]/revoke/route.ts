/**
 * POST /api/admin/orgs/[id]/keys/[keyId]/revoke — kill a leaked key.
 *
 * STAFF ONLY, role `admin`. Revoking a credential during an incident is the
 * same weight as suspending the account, which is why it is not `support`.
 *
 * `read_only` and `support` can SEE keys (the drill-down lists prefixes); they
 * cannot revoke one.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { adminRevokeKey } from '@/lib/admin/keys';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; keyId: string }> },
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // A reason is optional here: the revocation itself is the record, and
    // making it required during an incident would cost seconds that matter.
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('validation', 'Keep the reason under 500 characters.');

  try {
    const staff = await requireStaff('admin');
    const { id, keyId } = await params;

    // Both ids validated before any query: a garbage id must not become a
    // table scan, and must not be distinguishable from a missing one.
    if (!UUID.test(id) || !UUID.test(keyId)) return jsonError('not_found', 'No such key.');

    const result = await adminRevokeKey(staff.id, id, keyId, parsed.data.reason ?? '');

    if (!result.ok) {
      const code =
        result.error === 'not_found' ? 'not_found' : result.error === 'upstream' ? 'upstream' : 'conflict';
      return jsonError(code, result.message);
    }

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
