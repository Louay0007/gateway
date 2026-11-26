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

/**
 * The console's cookies (lib/auth/admin-auth.ts).
 *
 * A DIFFERENT NAME, and that is the entire isolation. `derivedKey` below is
 * HKDF over the cookie name, so the session token decrypts under a different
 * key than the portal's for the same AUTH_SECRET. `proxy.ts` reads only the
 * portal name, so a console session structurally cannot reach a tenant route
 * — and `currentStaffSession()` reads only this one, so a customer session
 * cannot open the console.
 *
 * DEFINED HERE, not in admin-auth.ts, because this module is what READS the
 * cookie and admin-auth.ts is what WRITES it: two copies of a cookie name is
 * how a session silently stops being found. admin-auth.ts imports these.
 */
export type StaffCookieKind = 'session-token' | 'csrf-token' | 'callback-url';

export function staffCookieName(kind: StaffCookieKind = 'session-token'): string {
  const authUrl = process.env.AUTH_URL;
  const secure = authUrl ? authUrl.startsWith('https://') : false;
  // `__Host-` for CSRF because that is @auth/core's own default: it is
  // STRICTER than `__Secure-` (Secure + Path=/ + no Domain), and widening a
  // security prefix to make a rename tidy would be the wrong trade.
  const prefix = secure ? (kind === 'csrf-token' ? '__Host-' : '__Secure-') : '';
  return `${prefix}authjs.staff-${kind}`;
}

/** The session cookie's full name — what the readers below use. */
export function staffSessionCookieName(): string {
  return staffCookieName('session-token');
}

/**
 * The session cookie's value, including Auth.js's `.0`, `.1`… chunks.
 *
 * `name` defaults to the PORTAL cookie so every existing caller is
 * unchanged; the console passes its own name (staffSessionFromHeaders).
 */
export function readSessionToken(
  headers: Headers,
  name: string = sessionCookieName(),
): string | null {
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
export async function decodeSessionToken(
  token: string,
  name: string = sessionCookieName(),
): Promise<SessionToken | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

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

/**
 * The console session for this request, or null.
 *
 * Same decode, other cookie name — and therefore a different derived key, so
 * this cannot return a portal identity and `sessionFromHeaders` above cannot
 * return a staff one. Proved in tests/admin-login.test.ts.
 */
export async function staffSessionFromHeaders(headers: Headers): Promise<SessionToken | null> {
  const name = staffCookieName();
  const token = readSessionToken(headers, name);
  return token ? decodeSessionToken(token, name) : null;
}
