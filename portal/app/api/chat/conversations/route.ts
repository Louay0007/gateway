/**
 * GET /api/chat/conversations — the sidebar list.
 *
 * Scoped to the caller's org AND user inside lib/chat/service.ts. There is
 * no pagination parameter yet on purpose: the query is bounded by
 * `archived_at IS NULL` and a 100-row cap, and keyset pagination for a list
 * that a real account fills in months is machinery for a problem we do not
 * have. The cap is the thing that has to change first, and it is one
 * number.
 */

import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse } from '@/lib/api/errors';
import { listConversations } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const conversations = await listConversations({
      organizationId: ctx.orgId,
      userId: ctx.userId,
    });
    return Response.json({ conversations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
