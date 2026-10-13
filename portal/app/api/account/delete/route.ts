/**
 * POST /api/account/delete — delete the account and its organization.
 *
 * Body: `{ confirmSlug }`.
 *
 * OWNER ONLY. Deleting the org cancels the subscription and revokes every
 * key, which is not something a developer or billing contact should be
 * able to do to an account they are a member of.
 *
 * TYPE-THE-SLUG confirmation. The operation is irreversible for access and
 * a mis-click here loses work that cannot be recovered, so the client
 * must send the organization's slug. The server compares it, which means
 * the friction cannot be skipped by crafting the request either — a
 * confirmation that lives only in the UI is not a confirmation.
 *
 * The ledger is RETAINED. `usage_records` is the billing record; both the
 * customer's history and the operator's reconciliation point at it. What
 * disappears is access. See `deleteAccount` in lib/account/service.ts for
 * the ordering and why it is that way round.
 */

import { z } from 'zod';
import { AccountError, deleteAccount } from '@/lib/account/service';
import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  confirmSlug: z.string().trim().min(1, 'Type your account slug to confirm.').max(48),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const ctx = await requireActiveOrg();
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can delete this account.');
    }

    const result = await deleteAccount({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      confirmSlug: parsed.data.confirmSlug,
    });

    return Response.json({ deleted: true, ...result });
  } catch (e) {
    if (e instanceof AccountError) {
      return jsonError(
        e.code === 'not_found'
          ? 'not_found'
          : e.code === 'conflict'
            ? 'conflict'
            : 'validation',
        e.message,
      );
    }
    return errorResponse(e);
  }
}