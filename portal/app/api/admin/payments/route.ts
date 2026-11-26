/**
 * GET /api/admin/payments — the cross-org payment ledger (D17 rail).
 *
 * STAFF ONLY, `support`.
 *
 * ONE RAIL ONLY, and the response says so: Dodo card payments are a hosted
 * checkout and we store no amount for them, so a merged total would be
 * arithmetic across two different populations. The page states this in words
 * rather than leaving the operator to infer it from a missing number.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listPayments } from '@/lib/admin/payments';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ['pending_payment', 'proof_submitted', 'paid', 'rejected', 'expired'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');

    const sp = new URL(request.url).searchParams;

    const status = sp.get('status');
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return jsonError('validation', `status must be one of: ${STATUSES.join(', ')}.`);
    }

    const organizationId = sp.get('organization');
    if (organizationId && !UUID.test(organizationId)) {
      return jsonError('validation', 'organization must be a UUID.');
    }

    const page = Number(sp.get('page') ?? '1');
    const pageSize = Number(sp.get('page_size') ?? '25');
    if (!Number.isFinite(page) || page < 1) {
      return jsonError('validation', 'page must be a positive whole number.');
    }
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      return jsonError('validation', 'page_size must be between 1 and 100.');
    }

    const result = await listPayments({
      status: status ?? undefined,
      q: sp.get('q') ?? undefined,
      organizationId: organizationId ?? undefined,
      staleOnly: sp.get('stale') === '1',
      page,
      pageSize,
    });

    return Response.json({ ...result, rail: 'd17' });
  } catch (e) {
    return errorResponse(e);
  }
}
