/**
 * Email-verification token rules — the reset flow's shape, different lock.
 *
 * Same primitive as password reset (see ./tokens.ts), different
 * namespace and TTL. A verification link is long-lived because it arrives
 * at signup, often before the person next opens their inbox; 24 hours is
 * long enough to be usable and short enough that a leaked mail is not a
 * permanent key.
 */

import { appOrigin, scopedIdentifier } from './tokens';

/** 24 hours. Signup mail is not a "respond now" prompt the way reset is. */
export const VERIFY_TTL_MINUTES = 24 * 60;

export const VERIFY_PREFIX = 'verify-email:';

/** `verify-email:<email>` — the token row's identifier. */
export function verifyIdentifierFor(email: string): string {
  return scopedIdentifier(VERIFY_PREFIX, email);
}

/**
 * The confirm URL the email carries. The token is the PATH SEGMENT, read
 * by `app/verify-email/[token]/page.tsx` — the exact lesson from the reset
 * link bug: a token hidden behind a nested path resolved against the
 * wrong route and every link failed silently.
 */
export function verifyLink(rawToken: string): string {
  return `${appOrigin()}/verify-email/${encodeURIComponent(rawToken)}`;
}
