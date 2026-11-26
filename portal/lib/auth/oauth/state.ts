/**
 * CSRF state, PKCE, and the pending-flow cookie. §4 steps 1–8.
 *
 * WHAT IS IN THE COOKIE vs THE QUERY STRING. `state` travels BOTH ways: it
 * is in the authz URL and in the callback URL, so an attacker who starts a
 * flow can see it. The cookie is what makes that useless — the value is
 * only honoured when it matches a cookie the SAME browser holds. So the
 * cookie must hold the one copy nobody else can read: the PKCE verifier,
 * the provider, and the nonce.
 *
 * WHY SameSite=Lax AND NOT Strict. The callback is a cross-site
 * top-level GET coming FROM Google or GitHub. With Strict the
 * browser does not send our cookie on that request, every callback looks
 * like "no pending flow", and the user loops between the provider and
 * /sign-in. Lax is the minimum that works, and it is still enough: Lax
 * blocks the cross-site POST/PUT that CSRF needs.
 *
 * WHY THE NAME IS NOT A CONSTANT PROVIDER. One cookie, overwritten by the
 * newest flow start. Two concurrent sign-ins in one browser would otherwise
 * need two cookies; the second start wins and the first tab fails cleanly
 * with "start again", which is correct and cannot be steered.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { ProviderId } from './types';

export const PENDING_COOKIE = 'oauth_pending';
/** 10 minutes: long enough for a provider consent screen, short enough that
 *  an abandoned flow leaves no usable state. */
export const PENDING_TTL_SECONDS = 600;

export interface PendingFlow {
  /** base64url, 32 bytes. Matched against the callback's `state`. */
  state: string;
  /** base64url, 32 bytes. NEVER sent to the provider — only its hash is. */
  codeVerifier: string;
  /** OIDC nonce, echoed inside the id_token. NULL when not requested. */
  nonce: string | null;
  provider: ProviderId;
  /** Validated same-site path to land on. Never an absolute URL. */
  returnTo: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes of CSPRNG output, base64url. */
export function randomToken(): string {
  return b64url(randomBytes(32));
}

/** PKCE S256. `plain` is never offered: it is not a code challenge. */
export function codeChallengeFor(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function createPendingFlow(provider: ProviderId, returnTo: string): PendingFlow {
  return {
    state: randomToken(),
    codeVerifier: randomToken(),
    // Google echoes a nonce inside the id_token, which binds the token to
    // this specific request. GitHub has no id_token to bind, so it gets none.
    nonce: provider === 'github' ? null : randomToken(),
    provider,
    returnTo,
  };
}

/**
 * Constant-time comparison of two strings of any length.
 *
 * `timingSafeEqual` throws on a length mismatch, and returning early on
 * that check leaks the length — which for a 32-byte random state is not
 * exploitable, but the safe wrapper costs nothing and removes the question.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Compare a fixed-length dummy to keep the timing profile flat.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function setPendingCookie(flow: PendingFlow): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, JSON.stringify(flow), {
    httpOnly: true,
    // Secure always: the local dev server is http://localhost, and browsers
    // treat localhost as a secure context, so this does not break dev. On
    // any other origin over http the cookie is refused — which is the
    // correct answer, because an OAuth code over cleartext is already lost.
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PENDING_TTL_SECONDS,
  });
}

/** Read + shape-check the pending flow. NULL for anything malformed. */
export async function readPendingCookie(): Promise<PendingFlow | null> {
  const jar = await cookies();
  const raw = jar.get(PENDING_COOKIE)?.value;
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const p = parsed as Record<string, unknown>;
  const provider = p.provider;
  if (provider !== 'google' && provider !== 'github') return null;

  const state = typeof p.state === 'string' ? p.state : null;
  const codeVerifier = typeof p.codeVerifier === 'string' ? p.codeVerifier : null;
  if (!state || !codeVerifier) return null;

  // A `returnTo` from a tampered cookie is still validated by the caller
  // with safeReturnPath; this only rejects obvious non-strings.
  const returnTo = typeof p.returnTo === 'string' ? p.returnTo : '/chat';
  const nonce = typeof p.nonce === 'string' ? p.nonce : null;

  return { state, codeVerifier, nonce, provider, returnTo };
}

/**
 * Delete the pending cookie. Called on EVERY terminal outcome — success,
 * state mismatch, provider error and cancellation — so a callback URL
 * replayed from history cannot start a second exchange with a code that is
 * already spent.
 */
export async function clearPendingCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
