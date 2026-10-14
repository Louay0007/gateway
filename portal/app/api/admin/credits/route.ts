/**
 * POST /api/admin/credits — record a manual credit / refund note.
 *
 * Body: { organizationId, amountCents, currency?, reason }.
 *
 * STAFF ONLY, role `admin` — moving money on a customer's behalf is not a
 * read-only act. D17 has no refund API, so this table is the RECORD of a
 * manual transfer ops makes by hand; it does not move money itself. The
 * amount is signed: negative refunds the customer, positive credits their
 * next bill.
 */

import { z } from 'zod';
import { requireStaff } from '@/lib/auth/authorize';
import { recordCreditNote } from '@/lib/billing/admin-console';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  organizationId: z.string().trim().regex(UUID, 'Choose an organization.'),
  amountCents: z.number().int().refine((n) => n !== 0, 'Enter a non-zero amount.'),
  currency: z.enum(['TND', 'USD']).optional(),
  reason: z.string().trim().min(3, 'Give a reason for the record.').max(500),
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
    const staff = await requireStaff('admin');
    const result = await recordCreditNote(staff.id, parsed.data);
    if (!result.ok) {
      if (result.error === 'reason_required') {
        return jsonError('validation', 'Give a reason for the record.');
      }
      if (result.error === 'amount_required') {
        return jsonError('validation', 'Enter a non-zero amount.');
      }
      return jsonError('not_found', 'No such organization.');
    }
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}
