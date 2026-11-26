/**
 * POST /api/admin/orgs/[id]/subscription/extend — add days to the period.
 *
 * STAFF ONLY, role `admin`. This is the "we were down for two days" fix: it
 * ADDS to the existing `current_period_end` rather than replacing it, so the
 * unused remainder of the period is not swallowed. Capped at 90 days so a
 * mistyped number cannot hand out a decade.
 *
 * A reason is required. An extension is a gift of service, and the next
 * operator needs to know why it was given.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { adminExtendPeriod, MAX_EXTEND_DAYS } from '@/lib/admin/subscriptions';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  days: z
    .number()
    .int()
    .min(1, 'Add at least one day.')
    .max(MAX_EXTEND_DAYS, `At most ${MAX_EXTEND_DAYS} days at a time.`),
  reason: z.string().trim().min(3, 'Give a reason for the extension.').max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await adminExtendPeriod(staff.id, id, parsed.data);

    if (!result.ok) {
      const code =
        result.error === 'not_found' || result.error === 'no_subscription'
          ? 'not_found'
          : result.error === 'reason_required'
            ? 'validation'
            : 'conflict';
      return jsonError(code, result.message);
    }

    return Response.json({
      ok: true,
      effect: result.effect,
      syncOk: result.syncOk,
      syncError: result.syncError,
      currentPeriodEnd: result.currentPeriodEnd ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
