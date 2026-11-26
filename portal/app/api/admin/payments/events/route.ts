/**
 * GET /api/admin/payments/events — webhooks that never completed.
 *
 * STAFF ONLY, `support`.
 *
 * This is the backlog nothing in the product could show: `billing_events` is
 * written by `applyCallback()` and was read by no screen, so a webhook that
 * failed five times was invisible — the subscription simply never activated
 * and the customer was told to try again.
 *
 * Read-only on purpose. Replaying an event is infrastructure work with a real
 * failure mode (a partially applied event replayed is worse than one left
 * alone); the operator's job here is to SEE it and escalate.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listFailedEvents } from '@/lib/admin/payments';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');

    const raw = new URL(request.url).searchParams.get('limit');
    const limit = raw === null ? 50 : Number(raw);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return jsonError('validation', 'limit must be between 1 and 200.');
    }

    return Response.json({ rows: await listFailedEvents(limit) });
  } catch (e) {
    return errorResponse(e);
  }
}
