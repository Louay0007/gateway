/**
 * POST /api/admin/system/resend-verification — re-send a confirmation link.
 *
 * STAFF ONLY, `support`.
 *
 * Answers the customer whose confirmation mail went to spam and who therefore
 * cannot check out — a paywall they cannot see the cause of. Delegates to
 * `sendVerificationEmail()`, exactly what the signup flow calls, so the "one
 * active token per account" rule applies here too: re-sending invalidates any
 * earlier link rather than leaving two usable tokens.
 *
 * NOT a password reset, and not a way to mark someone verified. The customer
 * still proves the address is theirs by clicking.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { resendVerification } from '@/lib/admin/system';
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
    const result = await resendVerification(staff.id, parsed.data.email);

    if (!result.ok) {
      const code =
        result.error === 'not_found' ? 'not_found' : result.error === 'conflict' ? 'conflict' : 'validation';
      return jsonError(code, result.message);
    }
    return Response.json({ ok: true, message: result.message });
  } catch (e) {
    return errorResponse(e);
  }
}
