/**
 * GET /api/admin/orgs — the admin console's org list.
 *
 * STAFF ONLY (`requireStaff('support')`). This is the widest read in the
 * product — every customer org, its plan, its gateway state and its
 * period spend — so the gate is deliberate and checked before any query.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listAdminOrgs } from '@/lib/billing/admin-console';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireStaff('support');
    const orgs = await listAdminOrgs();
    return Response.json({ orgs });
  } catch (e) {
    return errorResponse(e);
  }
}
