/**
 * PATCH /api/admin/trials/[id] — activate or deactivate a campaign code.
 *
 * STAFF ONLY, `owner`.
 *
 * THERE IS NO DELETE. `trial_redemptions.trial_code_id` is ON DELETE CASCADE,
 * so deleting a code would erase the record of everyone who redeemed it — a
 * campaign's only evidence that it worked. Deactivating refuses new
 * redemptions and leaves the history intact.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { setTrialCodeActive } from '@/lib/admin/trials';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({ active: z.boolean() });

export async function PATCH(
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
  if (!parsed.success) return jsonError('validation', 'active must be true or false.');

  try {
    const staff = await requireStaff('owner');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such trial code.');

    const result = await setTrialCodeActive(staff.id, id, parsed.data.active);

    if (!result.ok) {
      return jsonError(result.error === 'not_found' ? 'not_found' : 'conflict', result.message);
    }
    return Response.json({ ok: true, active: parsed.data.active });
  } catch (e) {
    return errorResponse(e);
  }
}
