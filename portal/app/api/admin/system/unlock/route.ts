/**
 * POST /api/admin/system/unlock — clear a login lockout.
 *
 * STAFF ONLY, `support`. Answering a customer who cannot sign in is exactly
 * the support tier's job, and clearing a throttle bucket is strictly less
 * powerful than the D17 approvals this role already makes.
 *
 * IT IS NOT A PASSWORD RESET. Staff cannot set a customer's password — that
 * would be impersonation by another name, which is the one thing the console
 * must never do.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { unlockIdentity } from '@/lib/admin/system';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().email().max(320) });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Enter an email address.');
  }

  try {
    const staff = await requireStaff('support');
    const result = await unlockIdentity(staff.id, parsed.data.email);

    if (!result.ok) {
      return jsonError(result.error === 'not_found' ? 'not_found' : 'validation', result.message);
    }
    return Response.json({ ok: true, message: result.message });
  } catch (e) {
    return errorResponse(e);
  }
}
