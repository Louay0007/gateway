/**
 * PATCH /api/profile — edit your own account.
 *
 * Body: `{ name }`.
 *
 * SELF-SCOPED. There is no "edit user X" route: the user id comes from the
 * session (`currentUser()`), never from the body or the URL. That is the
 * IDOR PLATFORM §10.1 is about, and for an account endpoint it is the
 * difference between a profile and a takeover.
 *
 * `email` is deliberately NOT accepted here. It is the identity
 * `authorize.ts` bridges auth → domain on; changing it would orphan every
 * membership, key attribution and audit row pointing at the old address.
 * The zod schema is `.strict()`, so an email in the body is a 400 rather
 * than a silently ignored field.
 */

import { z } from 'zod';
import { AccountError, updateProfile } from '@/lib/account/service';
import { currentUser } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120, 'Names are limited to 120 characters.'),
  })
  .strict();

export async function PATCH(request: Request): Promise<Response> {
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
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Your session has expired. Sign in again to continue.');
    }

    const result = await updateProfile({ userId: user.id, name: parsed.data.name });
    return Response.json({ name: result.name });
  } catch (e) {
    if (e instanceof AccountError) {
      return jsonError(
        e.code === 'not_found' ? 'not_found' : e.code === 'conflict' ? 'conflict' : 'validation',
        e.message,
      );
    }
    return errorResponse(e);
  }
}