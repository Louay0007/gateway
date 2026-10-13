/**
 * POST /api/profile/password — change your password while signed in.
 *
 * Body: `{ currentPassword, newPassword }`.
 *
 * REQUIRES THE CURRENT PASSWORD. Without that check this endpoint is a
 * takeover primitive: anyone at an unlocked browser, or anyone holding a
 * stolen cookie, could lock the real owner out of their own account. The
 * re-authentication is the control.
 *
 * On success EVERY existing session is invalidated, including the one that
 * made the request — `users.password_changed_at` is stamped and
 * `sessionIsFresh` (lib/auth/authorize.ts) rejects any JWT minted before
 * it. The response therefore says `reauthenticate: true`, and the client
 * sends the user to sign-in rather than pretending the cookie still works.
 * Without that, a customer who changed their password because they
 * suspected theft would be logged straight back in by the old session on
 * the next navigation.
 *
 * No `confirmPassword` field: the UI asks for it and this route trusts
 * that, because a server that cannot see the second entry has nothing to
 * compare — the check belongs where the second value exists.
 */

import { z } from 'zod';
import { AccountError, changePassword } from '@/lib/account/service';
import { currentUser } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(256),
  newPassword: z.string().min(1, 'Enter a new password.').max(256),
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
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Your session has expired. Sign in again to continue.');
    }

    const result = await changePassword({
      userId: user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });

    return Response.json({ changed: true, ...result, reauthenticate: true });
  } catch (e) {
    if (e instanceof AccountError) {
      // 400 with the message on the field: the form puts it under the
      // input that caused it rather than in a banner above a three-card
      // settings page.
      return jsonError(
        e.code === 'not_found' ? 'not_found' : e.code === 'conflict' ? 'conflict' : 'validation',
        e.message,
      );
    }
    return errorResponse(e);
  }
}