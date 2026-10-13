'use server';

/**
 * Email-verification server actions.
 *
 * Same shape as the reset actions: the form decides nothing, the action
 * validates and answers a small state object.
 *
 * The confirmation is a POST, not a GET, on purpose. Mail clients and
 * corporate scanners fetch links before the human sees them; a GET that
 * consumes the token would let a robot verify the address and, worse, burn
 * the link before the customer clicks it. The page renders a button; only
 * the button's submit consumes.
 */

import { consumeVerificationToken, sendVerificationEmail } from '@/lib/auth/verify-email';
import { currentUser } from '@/lib/auth/authorize';

export interface ConfirmEmailState {
  done?: boolean;
  error?: string;
  /** The address that was confirmed, for the success copy. */
  email?: string;
}

export interface ResendState {
  done?: boolean;
  error?: string;
}

export async function confirmEmailAction(
  _prev: ConfirmEmailState,
  formData: FormData,
): Promise<ConfirmEmailState> {
  const token = String(formData.get('token') ?? '').trim();
  if (!token) {
    return { error: 'This confirmation link is incomplete.' };
  }

  const result = await consumeVerificationToken(token);
  if (!result.ok) {
    return {
      error:
        'This confirmation link is invalid, already used, or has expired. ' +
        'Sign in and request a new one from your dashboard.',
    };
  }
  return { done: true, email: result.email };
}

/**
 * Resend from the dashboard. Requires a session; sends to the signed-in
 * identity only, so it cannot be used to spray arbitrary addresses.
 */
export async function resendVerificationAction(
  _prev: ResendState,
): Promise<ResendState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in first.' };

  const result = await sendVerificationEmail(user.authId);
  if (result.sent) return { done: true };
  if (result.reason === 'already_verified') {
    return { done: true };
  }
  return { error: 'We could not send the email just now. Try again in a moment.' };
}
