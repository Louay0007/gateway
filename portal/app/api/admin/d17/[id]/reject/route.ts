/**
 * POST /api/admin/d17/[id]/reject — refuse a payment proof.
 *
 * A reason is mandatory and bounded (500 chars). The customer is told what
 * was wrong and may submit one more proof; a second rejection is final and
 * the message says so. "One" is counted from `d17.rejected` audit rows by
 * `rejectD17Payment`, not trusted from the request — a client that lies
 * about how many attempts it has had changes nothing.
 *
 * `admin` rather than `support`: a rejection denies a customer a payment
 * they believe they made, so it is the escalation step, not the first one.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { rejectD17Payment } from '@/lib/billing/d17-admin';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('admin');

    const { id } = await params;
    if (!UUID.test(id)) {
      return jsonError('not_found', 'No such payment.');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError('validation', 'Request body must be JSON.');
    }

    const reason = typeof (body as { reason?: unknown })?.reason === 'string'
      ? (body as { reason: string }).reason.trim()
      : '';

    if (!reason) {
      return jsonError('validation', 'A reason is required — the customer is told what to fix.');
    }
    if (reason.length > 500) {
      return jsonError('validation', 'Keep the reason under 500 characters.');
    }

    const result = await rejectD17Payment(staff.id, id, reason);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 409;
      return jsonError(status === 404 ? 'not_found' : 'conflict', errorText(result.error));
    }

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorText(code: string | undefined): string {
  switch (code) {
    case 'not_found':
      return 'No such payment.';
    case 'not_submitted':
      return 'This payment has no proof waiting for review.';
    case 'reason_required':
      return 'A reason is required.';
    case 'reason_too_long':
      return 'Keep the reason under 500 characters.';
    default:
      return 'That payment could not be rejected.';
  }
}