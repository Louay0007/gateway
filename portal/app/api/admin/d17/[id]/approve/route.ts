/**
 * POST /api/admin/d17/[id]/approve — verify a payment proof.
 *
 * Idempotent by construction, and that property is the reason the admin
 * surface was worth rebuilding rather than re-creating the old action:
 * `approveD17Payment` routes through the SAME `applyCallback()` every
 * real provider uses, with the event id `d17:<paymentId>:approved`.
 * `billing_events` dedupes on that id, so a double click, a retried
 * request, and two admins racing on one payment all fulfil exactly once.
 * The payment row's own status guard is the second belt.
 *
 * The id is validated as a UUID before anything else: a garbage id must
 * not become a table scan, and must not be distinguishable from "no such
 * payment".
 */

import { requireStaff } from '@/lib/auth/authorize';
import { approveD17Payment } from '@/lib/billing/d17-admin';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const staff = await requireStaff('support');

    const { id } = await params;
    if (!UUID.test(id)) {
      return jsonError('not_found', 'No such payment.');
    }

    const result = await approveD17Payment(staff.id, id);
    if (!result.ok) {
      // not_found / not_submitted / activation_failed are all "nothing
      // was activated"; the client reloads the queue either way.
      const status = result.error === 'not_found' ? 404 : 409;
      return jsonError(status === 404 ? 'not_found' : 'conflict', errorText(result.error));
    }

    return Response.json({
      ok: true,
      alreadyApplied: result.alreadyApplied ?? false,
    });
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
    case 'activation_failed':
      return 'The subscription could not be activated. Nothing was charged; retry or escalate.';
    default:
      return 'That payment could not be approved.';
  }
}