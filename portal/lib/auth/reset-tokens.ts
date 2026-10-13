/**
 * Reset-token rules — pure cryptography, zero infrastructure.
 *
 * Split out of reset.ts for the same reason lib/entitlements/policy.ts
 * is separate from sync.ts: the rules that decide whether a recovery
 * link is safe must be testable without Postgres. Importing reset.ts
 * pulls in `db`, which throws in any environment without a database —
 * including the unit-test runner.
 *
 * Three rules live here and all three are load-bearing:
 *
 *   1. The identifier is namespaced and case-insensitive, so a
 *      mixed-case request finds the row a lowercase one created.
 *   2. What the database stores is sha256(raw) — a reader of
 *      `auth_verification_tokens` cannot reset a password from the table.
 *   3. The link points at OUR origin (never a caller-supplied one), so
 *      the token cannot be redirected off-site by a crafted request.
 */

import { createHash } from 'node:crypto';

export const TOKEN_TTL_MINUTES = 30;
export const TOKEN_BYTES = 32;
export const IDENTIFIER_PREFIX = 'password-reset:';

/** `password-reset:<email>` — the token row's identifier. */
export function identifierFor(email: string): string {
  return `${IDENTIFIER_PREFIX}${email.toLowerCase()}`;
}

/**
 * sha256 of the raw token. What the database stores; the raw value only
 * ever exists in the email (and, in dev, the log transport's output).
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function appOrigin(): string {
  return (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

/**
 * The confirm URL the email carries. Origin is always ours.
 *
 * The token is the PATH SEGMENT, because that is what the consuming page
 * reads: `app/reset-password/[token]/page.tsx` takes it from `params`.
 *
 * This used to build `/reset-password/confirm?token=…`. No route matched
 * that path literally, so Next resolved it against `[token]` with
 * `params.token === "confirm"` — the page rendered normally and the form
 * submitted the string "confirm" instead of the real token. Every reset
 * link in every email failed with "invalid or expired", with no error
 * anywhere. Unit tests missed it because they asserted the same wrong
 * shape they were written against; only clicking the actual emailed URL
 * shows it.
 */
export function resetLink(rawToken: string): string {
  return `${appOrigin()}/reset-password/${encodeURIComponent(rawToken)}`;
}
