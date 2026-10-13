'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validatePassword } from '@/lib/auth/password';
import { createLocalUser } from '@/lib/auth/create-user';
import { signIn } from '@/auth';
import { db } from '@/db';
import { authUsers } from '@/db/schema';

export interface SignUpState {
  error?: string;
  fieldErrors?: { email?: string; password?: string; confirm?: string };
}

/**
 * Local account creation — replaces the hosted Clerk sign-up flow.
 *
 * Order:
 *   1. Validate + hash the password (scrypt).
 *   2. Create the auth identity + credentials row.
 *   3. Mirror into the domain `users` table.
 *   4. Sign in, which lands the user on /dashboard. First-login org
 *      provisioning happens on the dashboard request
 *      (lib/auth/provision.ts).
 *
 * We do NOT create the org, team, or subscription here — that path is
 * idempotent and belongs on first authenticated load, so a user who
 * abandons the browser mid-signup does not leave a half-provisioned org.
 */

const emailSchema = z.string().email('Enter a valid email address.').max(320);

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const email    = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirm  = String(formData.get('confirm') ?? '');
  const name     = String(formData.get('name') ?? '').trim().slice(0, 120);

  const fieldErrors: SignUpState['fieldErrors'] = {};

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) fieldErrors.email = parsedEmail.error.issues[0]?.message;

  const pw = validatePassword(password);
  if (!pw.ok) fieldErrors.password = pw.error;
  if (confirm !== password) fieldErrors.confirm = 'Passwords do not match.';

  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // Reject an email that already has an identity without leaking that it
  // does — the generic copy covers both "taken" and "rate-limited".
  const existing = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, email),
  });
  if (existing) {
    return { error: 'That email cannot be registered. If you already have an account, sign in instead.' };
  }

  // The identity + credentials + domain mirror transaction itself lives
  // in lib/auth/create-user.ts, so any other caller that needs a real
  // account (scripts/verify-metering.ts) runs the same code as this form.
  // The session below resolves by email + password, so no id is needed.
  await createLocalUser({ email, name: name || null, password });

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/dashboard',
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: 'Account created, but automatic sign-in failed. Please sign in.' };
    }
    throw e;
  }
}