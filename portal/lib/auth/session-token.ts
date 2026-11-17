/**
 * Read the Auth.js session token from a request, without loading Auth.js.
 *
 * WHY NOT `getToken` FROM `next-auth/jwt`. It is the same decode, but it is
 * imported at module scope by `next-auth`, which drags the whole Auth.js
 * runtime (and its `next/server` import) into every request the proxy sees.
 * The proxy runs on all traffic; the decode is 30 lines of standard JWE. The
 * algorithm, the salt (the cookie name) and the secret derivation are
 * copied from `@auth/core/jwt` — and `tests/proxy-session.test.ts` proves
 * they agree by reading a token minted by Auth.js's own `encode`.
 *
 * WHAT A SUCCESSFUL DECODE PROVES: this deployment minted the token and it
 * has not expired. It does NOT prove the account still exists, still holds
 * a role, or still belongs to the org in the URL — `lib/auth/authorize.ts`
 * re-reads all of that from Postgres on every protected action.
 */

import { jwtDecrypt } from 'jose';
import { hkdf } from '@panva/hkdf';

/** `A256CBC-HS512`, as `@auth/core/jwt` encrypts session tokens. */
const ENC = 'A256CBC-HS512';
const ALG = 'dir';

/**
 * The cookie Auth.js set for this deployment.
 *
 * Derived exactly as `@auth/core` does: `useSecureCookies ?? url.protocol ===
 * 'https:'`, and `next-auth` rewrites the request origin from AUTH_URL before
 * the config is evaluated (lib/env.ts `reqWithEnvURL`). So in production —
 * where compose sets AUTH_URL to the portal's https origin — the prefixed
 * name is the one issued, whatever protocol the container itself sees.
 */
export function sessionCookieName(): string {
  const authUrl = process.env.AUTH_URL;
  const secure = authUrl ? authUrl.startsWith('https://') : false;
  return secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

/** The session cookie's value, including Auth.js's `.0`, `.1`… chunks. */
export function readSessionToken(headers: Headers): string | null {
  const name = sessionCookieName();
  const cookie = headers.get('cookie');
  if (!cookie) return null;

  // `@auth/core`'s SessionStore takes EVERY cookie whose name starts with the
  // session name and joins them in NUMERIC suffix order — `.10` after `.2`,
  // not before it, or a long token decodes to garbage. The bare name and
  // `.0` are both accepted because a store may write either for the first
  // chunk; matching only the exact names Auth.js happens to emit today would
  // turn a cookie-library change into a silent lockout.
  const chunks: Record<string, string> = {};
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key.startsWith(name) || !key.slice(name.length).match(/^(\.\d+)?$/)) continue;
    chunks[key] = part.slice(eq + 1).trim();
  }
  const keys = Object.keys(chunks);
  if (keys.length === 0) return null;

  return keys
    .sort((a, b) => Number(a.slice(name.length + 1) || 0) - Number(b.slice(name.length + 1) || 0))
    .map((k) => chunks[k])
    .join('');
}

/**
 * Key derivation, copied from `@auth/core/jwt` (`getDerivedEncryptionKey`).
 *
 * The hash algorithm is a parameter there — `hkdf("sha256", …)` — and omitting
 * it here was a real disagreement: the two derivations produced different
 * keys and every valid session was refused. `tests/proxy-session.test.ts`
 * catches exactly that, against a token Auth.js minted.
 */
async function derivedKey(secret: string, salt: string): Promise<Uint8Array> {
  return hkdf('sha256', secret, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
}

export interface SessionToken {
  sub: string;
  email?: string;
  exp?: number;
}

/**
 * Decode the token, or null.
 *
 * Never throws: a malformed, foreign-key or expired token is an
 * unauthenticated request, which is a decision the caller makes, not an
 * error. `sub` must be a non-empty string — a decryptable token without one
 * is not an identity this deployment issues.
 */
export async function decodeSessionToken(token: string): Promise<SessionToken | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const name = sessionCookieName();
  try {
    const derived = await derivedKey(secret, name);
    const { payload } = await jwtDecrypt(token, derived, {
      clockTolerance: 15, // matches @auth/core, so clock skew cannot split the two reads
      keyManagementAlgorithms: [ALG],
      contentEncryptionAlgorithms: [ENC, 'A256GCM'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return {
      sub: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
    };
  } catch {
    return null;
  }
}

/** The authenticated caller for this request, or null. */
export async function sessionFromHeaders(headers: Headers): Promise<SessionToken | null> {
  const token = readSessionToken(headers);
  return token ? decodeSessionToken(token) : null;
}
