/**
 * DELETE /api/keys/[id] — revoke a key (C-05).
 *
 * Two rules the route enforces before the service is reached:
 *   - the id must be a UUID, so a garbage id cannot become a table scan;
 *   - a malformed id answers 404, not 400, so probing cannot distinguish
 *     "no such key" from "not yours".
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { revokeKey } from '@/lib/keys';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return jsonError('not_found', 'Key not found.');
    }

    const ctx = await requireActiveOrg();
    const revoked = await revokeKey({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
      keyId: id,
    });
    return Response.json(revoked);
  } catch (e) {
    return errorResponse(e);
  }
}
