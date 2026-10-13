'use server';

/**
 * Password-reset server actions.
 *
 * Both follow the sign-up/sign-in shape (useActionState + field errors)
 * so the forms stay client components that decide nothing.
 *
 * The request action answers `done` in EVERY case — unknown email,
 * throttled, or sent. The only distinction a caller can observe is time,
 * which is the price of not leaking which addresses have accounts.
 */

import { z } from 'zod';
import { completePasswordReset, requestPasswordReset } from '@/lib/auth/reset';
import { checkThrottle, recordFailure } from '@/lib/auth/throttle';

export interface ResetRequestState {
  done?: boolean;
  error?: string;
  fieldErrors?: { email?: string };
}

export interface ResetConfirmState {
  done?: boolean;
  error?: string;
  fieldErrors?: { password?: string; confirmPassword?: string };
}

const emailSchema = z.string().email('Enter a valid email address.').max(320);
const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(256, 'Password is too long.');

/** Reset requests are throttled on the identity — spraying one inbox. */
function throttleId(email: string): string {
  return `reset:${email}`;
}

export async function requestResetAction(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { fieldErrors: { email: parsed.error.issues[0]?.message } };
  }

  const state = await checkThrottle(throttleId(email), 'unknown');
  if (state.blocked) {
    // Same answer as success: a blocked caller learns nothing about the
    // account, and a real user is told to wait rather than "no user".
    return { done: true };
  }

  try {
    await requestPasswordReset(email);
  } catch (e) {
    // Never surface a mail failure as a difference in the response.
    await recordFailure(throttleId(email), 'unknown').catch(() => {});
    void e;
  }

  return { done: true };
}

export async function completeResetAction(
  _prev: ResetConfirmState,
  formData: FormData,
): Promise<ResetConfirmState> {
  const raw = {
    token: String(formData.get('token') ?? ''),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  };

  const fieldErrors: ResetConfirmState['fieldErrors'] = {};
  if (!raw.token) {
    return { error: 'This reset link is incomplete. Request a new one.' };
  }
  const pw = passwordSchema.safeParse(raw.password);
  if (!pw.success) fieldErrors.password = pw.error.issues[0]?.message;
  if (raw.password !== raw.confirmPassword) {
    fieldErrors.confirmPassword = 'The two passwords do not match.';
  }
  if (fieldErrors.password || fieldErrors.confirmPassword) {
    return { fieldErrors };
  }

  const result = await completePasswordReset(raw.token, raw.password);
  if (!result.ok) {
    // One message for expired, unknown, and already-used tokens.
    return {
      error:
        'This reset link is invalid or has expired. Request a new one and try again.',
    };
  }

  return { done: true };
}
