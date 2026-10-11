'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import { signIn } from '@/auth';
import { db } from '@/db';
import { authUsers, authCredentials, users } from '@/db/schema';

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
    where: (await import('drizzle-orm')).eq(authUsers.email, email),
  });
  if (existing) {
    return { error: 'That email cannot be registered. If you already have an account, sign in instead.' };
  }

  const hash = await hashPassword(password);
  const userId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(authUsers).values({
      id: userId,
      name: name || null,
      email,
      emailVerified: null,   // no mail transport yet; Phase 6 adds verification
    });
    await tx.insert(authCredentials).values({ userId, password: hash });
    // Domain mirror (authoritative for product logic).
    await tx.insert(users).values({
      authProvider: 'authjs',
      authId: userId,
      email,
      name: name || null,
    });
  });

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