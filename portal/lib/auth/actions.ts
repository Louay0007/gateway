'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn, signOut } from '@/auth';

/**
 * Sign in / sign up server actions.
 *
 * Auth.js's `signIn` performs the redirect internally on success; on
 * failure it throws `AuthError` (redirect disabled) or
 * `CallbackRouteError`. We catch, map to a generic message, and return
 * field errors rather than letting anything reach the client verbatim.
 *
 * Security: the error copy never distinguishes "no such account" from
 * "wrong password". See password.ts for the matching timing profile.
 */

export interface AuthFormState {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
}

const emailSchema = z.string().email('Enter a valid email address.').max(320);
const passwordSchema = z.string().min(1, 'Enter your password.');

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
  };

  const parsed = emailSchema.safeParse(raw.email);
  const parsedPw = passwordSchema.safeParse(raw.password);
  const fieldErrors: AuthFormState['fieldErrors'] = {};
  if (!parsed.success) fieldErrors.email = parsed.error.issues[0]?.message;
  if (!parsedPw.success) fieldErrors.password = parsedPw.error.issues[0]?.message;
  if (fieldErrors.email || fieldErrors.password) return { fieldErrors };

  // Build an ABSOLUTE callback URL from the configured canonical origin.
  //
  // Auth.js resolves a relative `redirectTo` against the origin it infers
  // from the request. Behind Caddy that inference is wrong unless
  // AUTH_URL is set, and the failure is silent: the user lands on `/`
  // instead of the page they asked for. Constructing the URL from an
  // explicit origin removes the guesswork.
  const origin = (process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const target = String(formData.get('callbackUrl') ?? '/dashboard');
  // Only same-site relative paths are accepted, so this cannot be used to
  // build an open redirect.
  const safeTarget = target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard';
  const callbackUrl = origin ? `${origin}${safeTarget}` : safeTarget;

  try {
    await signIn('credentials', {
      email: raw.email,
      password: raw.password,
      redirectTo: callbackUrl,
    });
    // signIn throws NEXT_REDIRECT on success; execution does not continue.
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      // CredentialsSignin covers both throttle-rejection and bad-password;
      // we return one message for both so the endpoint cannot be used to
      // probe which emails exist or are currently locked.
      if (e.type === 'CredentialsSignin') {
        return { error: 'Those credentials did not match our records, or the account is temporarily locked.' };
      }
      return { error: 'Sign-in failed. Please try again.' };
    }
    // Re-throw the framework's own redirect control-flow signal.
    throw e;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}