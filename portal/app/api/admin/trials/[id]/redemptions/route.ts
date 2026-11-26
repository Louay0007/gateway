/**
 * GET /api/admin/trials/[id]/redemptions — who used a campaign code.
 *
 * STAFF ONLY, `support`. The question a marketing campaign is actually asked:
 * "did it work, and on whom".
 */

import { requireStaff } from '@/lib/auth/authorize';
import { trialRedemptions } from '@/lib/admin/trials';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireStaff('support');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such trial code.');

    return Response.json({ rows: await trialRedemptions(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
