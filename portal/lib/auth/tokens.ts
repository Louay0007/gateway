/**
 * Emailed-token primitives — shared by password reset and email
 * verification.
 *
 * The two flows differ in TTL, identifier namespace and link path, but the
 * security-critical mechanics are identical and must never drift: sha256 at
 * rest, a random 32-byte raw value, a namespaced case-insensitive
 * identifier, and a link whose origin is always ours. Those live here once.
 */

import { createHash } from 'node:crypto';

/** Entropy per raw token. 32 bytes = 256 bits; guessing is not a strategy. */
export const TOKEN_BYTES = 32;

/** sha256 of the raw token — what the database stores. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * `<prefix><email>` — the token row's identifier. Namespacing means one
 * table can hold both reset and verification tokens without collision, and
 * lowercasing means a mixed-case request finds the row a lowercase one
 * created.
 */
export function scopedIdentifier(prefix: string, email: string): string {
  return `${prefix}${email.toLowerCase()}`;
}

/**
 * The application origin, used to build every emailed link. Always ours,
 * never caller-supplied, so a crafted request cannot redirect a token
 * off-site.
 */
export function appOrigin(): string {
  return (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
}
