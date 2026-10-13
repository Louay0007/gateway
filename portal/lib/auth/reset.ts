/**
 * Password reset — the missing account-recovery path.
 *
 * A forgotten password on a self-hosted credentials provider is not a
 * support ticket: `users.email` is UNIQUE, so the email is unusable
 * forever without operator access to the database. This module is the
 * fix, and it is deliberately boring.
 *
 * Design rules, all load-bearing:
 *
 *   1. NO ACCOUNT ENUMERATION. The request route answers 200 whether or
 *      not the email exists, and the completion failure copy is the same
 *      for "no such token" and "expired token". The request email is
 *      sent only when the account exists, which is unobservable to the
 *      caller.
 *   2. THE STORED TOKEN IS A HASH. `auth_verification_tokens.token`
 *      holds sha256(raw), the raw goes only into the email. A database
 *      reader cannot reset a password from the table alone.
 *   3. ONE ACTIVE TOKEN PER ACCOUNT. A new request deletes the
 *      previous row, so a leaked old link dies the moment a new one is
 *      requested.
 *   4. SINGLE USE + SHORT TTL. Consumed on success (all rows for the
 *      identifier are deleted), 30 minutes to live.
 *
 * KNOWN LIMIT — RESOLVED by migration 0006. Sessions are JWTs
 * (PLATFORM.md §2.1), so a password change could not revoke an
 * already-issued token: a copied session lived at most `maxAge` (7 days).
 * `users.password_changed_at` is now stamped on every credential change
 * and copied into the JWT at sign-in, and `sessionIsFresh`
 * (lib/auth/authorize.ts) rejects a token that predates it — so a reset
 * taken because a password may be stolen now actually ends the stolen
 * session, instead of merely letting the rightful owner set a new
 * password alongside it.
 */

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { authCredentials, authUsers, authVerificationTokens, users } from '@/db/schema';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import {
  IDENTIFIER_PREFIX,
  TOKEN_BYTES,
  TOKEN_TTL_MINUTES,
  hashToken,
  identifierFor,
  resetLink,
} from '@/lib/auth/reset-tokens';
import { sendEmail } from '@/lib/email';
import { log } from '@/lib/log';

async function emailForToken(email: string): Promise<string | null> {
  const user = await db.query.authUsers.findFirst({ where: eq(authUsers.email, email) });
  return user?.email ?? null;
}

/**
 * Create and send a reset link for `email`.
 *
 * Returns whether a link was SENT (i.e. the account exists and the mail
 * transport accepted it). The caller answers 200 either way — the return
 * value exists for the log and the tests, not for the client.
 */
export async function requestPasswordReset(emailRaw: string): Promise<{
  sent: boolean;
  reason?: 'no_account' | 'send_failed';
}> {
  const email = emailRaw.trim().toLowerCase();
  const canonical = await emailForToken(email);
  if (!canonical) {
    // Same latency profile as the happy path: the caller does not wait
    // on a send, but a distinct early return would still be observable
    // by a timer. The KDF never runs here, so this is best-effort.
    return { sent: false, reason: 'no_account' };
  }

  // Rule 3: one active token per account.
  await db
    .delete(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, identifierFor(canonical)));

  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db.insert(authVerificationTokens).values({
    identifier: identifierFor(canonical),
    token: hashToken(raw),
    expires,
  });

  try {
    await sendEmail({
      to: canonical,
      subject: 'Reset your password',
      text:
        `We received a request to reset the password for ${canonical}.\n\n` +
        `Open this link to choose a new password (valid ${TOKEN_TTL_MINUTES} minutes):\n` +
        `${resetLink(raw)}\n\n` +
        `If you did not request a reset, you can ignore this email — your ` +
        `password stays as it is, and this link stops working on its own.`,
    });
  } catch (e) {
    log.error('password reset: send failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { sent: false, reason: 'send_failed' };
  }

  return { sent: true };
}

export interface CompleteResetResult {
  ok: boolean
  reason?: 'invalid_token' | 'weak_password';
}

/**
 * Consume a token and set a new password.
 *
 * Failure copy is identical for every failure reason so the endpoint
 * cannot be used to probe which tokens ever existed.
 */
export async function completePasswordReset(
  tokenRaw: string,
  newPassword: string,
): Promise<CompleteResetResult> {
  const token = tokenRaw.trim();

  const validation = validatePassword(newPassword);
  if (!validation.ok) {
    return { ok: false, reason: 'weak_password' };
  }

  // Look up by hash; the raw token never touches the database.
  const row = await db.query.authVerificationTokens.findFirst({
    where: eq(authVerificationTokens.token, hashToken(token)),
  });
  if (!row) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (row.expires.getTime() < Date.now()) {
    await db.delete(authVerificationTokens).where(
      and(
        eq(authVerificationTokens.identifier, row.identifier),
        eq(authVerificationTokens.token, row.token),
      ),
    );
    return { ok: false, reason: 'invalid_token' };
  }

  const email = row.identifier.startsWith(IDENTIFIER_PREFIX)
    ? row.identifier.slice(IDENTIFIER_PREFIX.length)
    : null;
  if (!email) {
    return { ok: false, reason: 'invalid_token' };
  }

  const user = await db.query.authUsers.findFirst({ where: eq(authUsers.email, email) });
  if (!user) {
    return { ok: false, reason: 'invalid_token' };
  }

  const hash = await hashPassword(newPassword);
  const changedAt = new Date();

  // Credentials, the validity stamp, and token cleanup together. The
  // stamp is what invalidates every OTHER session (see the header), so it
  // must not be able to be skipped by a crash between statements.
  await db.transaction(async (tx) => {
    await tx
      .insert(authCredentials)
      .values({ userId: user.id, password: hash, updatedAt: changedAt })
      .onConflictDoUpdate({
        target: authCredentials.userId,
        set: { password: hash, updatedAt: changedAt },
      });

    await tx
      .update(users)
      .set({ passwordChangedAt: changedAt, updatedAt: changedAt })
      .where(
        and(
          eq(users.authProvider, 'authjs'),
          eq(users.authId, user.id),
        ),
      );

    // Rule 4: consume every token this account holds.
    await tx
      .delete(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, row.identifier));
  });

  log.info('password reset: password changed', { authUserId: user.id });
  return { ok: true };
}
