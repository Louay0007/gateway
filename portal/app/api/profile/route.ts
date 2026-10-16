/**
 * /api/profile — read and edit your own account.
 *
 *   GET   → `{ name, email, emailVerifiedAt, image, createdAt }`
 *   PATCH → `{ name?, image? }` answers `{ name, image }`
 *
 * SELF-SCOPED. There is no "user X" route: the user id comes from the
 * session (`currentUser()`), never from the body or the URL. That is the
 * IDOR PLATFORM §10.1 is about, and for an account endpoint it is the
 * difference between a profile and a takeover.
 *
 * `email` is deliberately NOT accepted on PATCH. It is the identity
 * `authorize.ts` bridges auth → domain on; changing it would orphan every
 * membership, key attribution and audit row pointing at the old address.
 * The zod schema is `.strict()`, so an email in the body is a 400 rather
 * than a silently ignored field.
 */

import { z } from 'zod';
import { AccountError, getProfile, updateProfile } from '@/lib/account/service';
import { currentUser } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A picture is a small data URL, not a file upload: no multipart parsing,
 * no object store, no temp files to clean up. The envelope is checked here
 * (cheap string match) and the CONTENT in the service (magic bytes,
 * decoded-size cap) — the route rejects shape, the service rejects lies.
 */
const patchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter a name.')
      .max(120, 'Names are limited to 120 characters.')
      .optional(),
    image: z.string().max(400_000, 'Picture is too large.').nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.image !== undefined, {
    message: 'Nothing to update.',
  });

function accountErrorResponse(e: unknown): Response {
  if (e instanceof AccountError) {
    return jsonError(
      e.code === 'not_found' ? 'not_found' : e.code === 'conflict' ? 'conflict' : 'validation',
      e.message,
    );
  }
  return errorResponse(e);
}

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Your session has expired. Sign in again to continue.');
    }
    return Response.json(await getProfile({ userId: user.id }));
  } catch (e) {
    return accountErrorResponse(e);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid request.',
    );
  }

  try {
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Your session has expired. Sign in again to continue.');
    }

    const result = await updateProfile({
      userId: user.id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.image !== undefined ? { image: parsed.data.image } : {}),
    });
    return Response.json(result);
  } catch (e) {
    return accountErrorResponse(e);
  }
}
