/**
 * Email verification — prove the address on the account is reachable.
 *
 * Why this exists: `users.email` is written at signup and never checked.
 * Everything the payment flow says about a manual D17 transfer — verified,
 * rejected with a reason, activated — is sent to that address. An address
 * the customer does not own is a customer who never learns their money was
 * received. This closes that hole before any payment can start.
 *
 * The mechanics are the password-reset mechanics (lib/auth/reset.ts), on
 * purpose: one token table, one hashing rule, one "always answer the same
 * thing" discipline. Differences are TTL and namespace only.
 *
 * Rules:
 *   1. ONE ACTIVE TOKEN PER ACCOUNT. Re-requesting deletes the prior row,
 *      so the newest mail is the only one that works.
 *   2. STORED AS A HASH. The table holds sha256(raw); the raw lives only in
 *      the email (and the dev log transport).
 *   3. SINGLE USE. Consumption deletes every row for the identifier.
 *   4. GRANDFATHERED ACCOUNTS. Rows created before migration 0008 are
 *      already stamped; `sendVerificationEmail` is a no-op for them.
 */

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { authUsers, authVerificationTokens, users } from '@/db/schema';
import { AuthzError } from '@/lib/auth/errors';
import { sendEmail } from '@/lib/email';
import { buttonHtml, logoAttachment, textToHtml, wrapEmail } from '@/lib/email/layout';
import { log } from '@/lib/log';
import { hashToken, TOKEN_BYTES } from './tokens';
import { VERIFY_PREFIX, VERIFY_TTL_MINUTES, verifyIdentifierFor, verifyLink } from './verify-tokens';

/**
 * Whether the domain user row has a verification stamp.
 *
 * Read from `users.email_verified_at` (the product row), not the Auth.js
 * identity, so the gate and every product surface agree on one value.
 */
export async function isEmailVerified(domainUserId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, domainUserId),
    columns: { emailVerifiedAt: true },
  });
  return Boolean(row?.emailVerifiedAt);
}

/**
 * Throw a 403 the API envelope can render when the address is unverified.
 *
 * The message names the action and the fix, because "forbidden" with no
 * next step is the dead end that makes a customer email support.
 */
export async function requireVerifiedEmail(domainUserId: string): Promise<void> {
  if (await isEmailVerified(domainUserId)) return;
  throw new AuthzError(
    'Confirm your email address first — check your inbox for the link, or resend it from your dashboard.',
    'forbidden',
    403,
  );
}

export interface SendVerificationResult {
  sent: boolean;
  /** Why it was not sent. `already_verified` is success for the caller. */
  reason?: 'already_verified' | 'no_account' | 'send_failed';
}

/**
 * Send (or resend) a verification link to an account that is not yet
 * verified. Safe to call repeatedly; the previous link dies on send.
 */
export async function sendVerificationEmail(
  authUserId: string,
): Promise<SendVerificationResult> {
  const identity = await db.query.authUsers.findFirst({
    where: eq(authUsers.id, authUserId),
  });
  if (!identity) return { sent: false, reason: 'no_account' };
  if (identity.emailVerified) return { sent: false, reason: 'already_verified' };

  const email = identity.email.toLowerCase();

  // Rule 1: one active token per account.
  await db
    .delete(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, verifyIdentifierFor(email)));

  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  const expires = new Date(Date.now() + VERIFY_TTL_MINUTES * 60 * 1000);

  await db.insert(authVerificationTokens).values({
    identifier: verifyIdentifierFor(email),
    token: hashToken(raw),
    expires,
  });

  try {
    const link = verifyLink(raw);
    const bodyText =
      `Welcome to Zaino AI.\n\n` +
      `Confirm this address to finish setting up your account (the link is valid ` +
      `${Math.round(VERIFY_TTL_MINUTES / 60)} hours):\n` +
      `${link}\n\n` +
      `Until it is confirmed you can browse the dashboard, but you cannot ` +
      `create an API key or start a subscription.\n\n` +
      `If you did not create this account, you can ignore this email.`;
    const bodyHtml =
      `<p style="margin:0 0 12px 0;">Welcome to Zaino AI.</p>` +
      `<p style="margin:0 0 12px 0;">Confirm this address to finish setting up your account (the link is valid ${Math.round(VERIFY_TTL_MINUTES / 60)} hours):</p>` +
      buttonHtml(link, 'Confirm Email Address') +
      `<p style="margin:0 0 12px 0;">Until it is confirmed you can browse the dashboard, but you cannot create an API key or start a subscription.</p>` +
      `<p style="margin:0;color:#666666;font-size:13px;">If you did not create this account, you can ignore this email.</p>`;
    await sendEmail({
      to: email,
      subject: 'Confirm your email address',
      text: bodyText,
      html: wrapEmail(bodyHtml),
      attachments: [logoAttachment()],
    });
  } catch (e) {
    log.error('email verification: send failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { sent: false, reason: 'send_failed' };
  }

  return { sent: true };
}

export interface ConsumeVerificationResult {
  ok: boolean;
  /** Present on success: the address that was verified. */
  email?: string;
  reason?: 'invalid_token' | 'not_for_verification';
}

/**
 * Consume a verification token: stamp the identity, mirror the stamp onto
 * the domain row, and delete every token the account holds.
 *
 * Idempotent in effect: consuming an already-consumed token yields
 * `invalid_token` (the rows are gone), which the page renders as "this link
 * has already been used or expired" — never as a server error.
 */
export async function consumeVerificationToken(
  rawToken: string,
): Promise<ConsumeVerificationResult> {
  const token = rawToken.trim();
  if (!token) return { ok: false, reason: 'invalid_token' };

  const row = await db.query.authVerificationTokens.findFirst({
    where: eq(authVerificationTokens.token, hashToken(token)),
  });
  if (!row) return { ok: false, reason: 'invalid_token' };
  if (!row.identifier.startsWith(VERIFY_PREFIX)) {
    // A reset token presented here must not verify an account.
    return { ok: false, reason: 'not_for_verification' };
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

  const email = row.identifier.slice(VERIFY_PREFIX.length);
  const identity = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, email),
  });
  if (!identity) return { ok: false, reason: 'invalid_token' };

  const verifiedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(authUsers)
      .set({ emailVerified: verifiedAt })
      .where(eq(authUsers.id, identity.id));

    // Domain mirror — the row every product read uses.
    await tx
      .update(users)
      .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
      .where(and(eq(users.authProvider, 'authjs'), eq(users.authId, identity.id)));

    // Rule 3: single use.
    await tx
      .delete(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, row.identifier));
  });

  log.info('email verification: address confirmed', { authUserId: identity.id });
  return { ok: true, email };
}
