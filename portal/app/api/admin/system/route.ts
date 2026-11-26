/**
 * GET /api/admin/system — the two recoverability queues.
 *
 * STAFF ONLY, `support`.
 *
 *   lockouts   — identities currently throttled out of signing in
 *   unverified — accounts that cannot check out because their address was
 *                never confirmed
 *
 * Both are read-only here; the two actions live in their own routes so each
 * one can be audited on its own.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listLockedIdentities, listUnverifiedCustomers } from '@/lib/admin/system';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireStaff('support');

    const [lockouts, unverified] = await Promise.all([
      listLockedIdentities(),
      listUnverifiedCustomers(),
    ]);

    return Response.json({ lockouts, unverified });
  } catch (e) {
    return errorResponse(e);
  }
}
