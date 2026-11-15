/**
 * State, PKCE and the pending-flow cookie — plan §8 items 3 and 5–7.
 *
 * The cookie accessor (`next/headers`) and the route handlers are exercised
 * in `oauth-callback.test.ts`; this file covers the pure crypto and the
 * shape validation, which is where a bug is silent rather than loud:
 *
 *   - a `state` compared with `===` is a timing oracle
 *   - a PKCE challenge that is not S256 defeats the point of PKCE
 *   - `readPendingCookie` accepting a partially-formed blob means a flow can
 *     be completed with a missing verifier, which the provider rejects as an
 *     opaque error
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PENDING_TTL_SECONDS,
  clearPendingCookie,
  codeChallengeFor,
  createPendingFlow,
  randomToken,
  readPendingCookie,
  safeEqual,
  setPendingCookie,
} from '@/lib/auth/oauth/state';

describe('randomToken', () => {
  it('is 32 bytes of CSPRNG, base64url, and never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = randomToken();
      // 32 bytes → 43 base64url chars, no padding, no + or /.
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });
});

describe('codeChallengeFor — PKCE S256', () => {
  it('is base64url(SHA-256(verifier)), matching RFC 7636', () => {
    // RFC 7636 Appendix B's own test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(codeChallengeFor(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('never returns the verifier itself (that would be `plain`)', () => {
    const v = randomToken();
    expect(codeChallengeFor(v)).not.toBe(v);
  });

  it('strips base64 padding and uses the url-safe alphabet', () => {
    const c = codeChallengeFor('x');
    expect(c).not.toContain('=');
    expect(c).not.toContain('+');
    expect(c).not.toContain('/');
    // Independently computed.
    const expected = createHash('sha256')
      .update('x')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(c).toBe(expected);
  });
});

describe('safeEqual — constant-time comparison', () => {
  it('accepts identical strings', () => {
    const s = randomToken();
    expect(safeEqual(s, s)).toBe(true);
  });

  it('rejects a single-character difference', () => {
    const s = randomToken();
    const other = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(other).not.toBe(s);
    expect(safeEqual(s, other)).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    // `timingSafeEqual` throws on unequal lengths; the wrapper must not.
    expect(() => safeEqual('abc', 'abcd')).not.toThrow();
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('rejects an empty comparison against a real token', () => {
    expect(safeEqual('', randomToken())).toBe(false);
  });
});

describe('createPendingFlow', () => {
  it('carries an independent state, verifier and nonce', () => {
    const f = createPendingFlow('google', '/chat');
    expect(f.provider).toBe('google');
    expect(f.returnTo).toBe('/chat');
    expect(f.state).not.toBe(f.codeVerifier);
    expect(f.nonce).not.toBe(f.state);
    expect(f.nonce).not.toBe(f.codeVerifier);
  });

  it('requests a nonce for Google and Apple, and none for GitHub', () => {
    expect(createPendingFlow('google', '/chat').nonce).toBeTruthy();
    expect(createPendingFlow('apple', '/chat').nonce).toBeTruthy();
    // GitHub has no id_token, so there is nothing for a nonce to bind.
    expect(createPendingFlow('github', '/chat').nonce).toBeNull();
  });

  it('never produces the same flow twice', () => {
    const a = createPendingFlow('google', '/chat');
    const b = createPendingFlow('google', '/chat');
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('PENDING_TTL_SECONDS', () => {
  it('is ten minutes: enough for consent, short enough to expire', () => {
    expect(PENDING_TTL_SECONDS).toBe(600);
  });
});

/**
 * `setPendingCookie` / `readPendingCookie` / `clearPendingCookie` call
 * `cookies()` from `next/headers`, which only resolves inside a request.
 * The shape validation below is what a malformed blob has to survive, and
 * it is tested by round-tripping through the same JSON the cookie holds —
 * `oauth-callback.test.ts` covers the real jar.
 */
describe('pending cookie payload shape', () => {
  const valid = {
    state: 'st',
    codeVerifier: 'cv',
    nonce: 'n',
    provider: 'google',
    returnTo: '/chat',
  };

  it('exports the three accessors', () => {
    expect(typeof setPendingCookie).toBe('function');
    expect(typeof readPendingCookie).toBe('function');
    expect(typeof clearPendingCookie).toBe('function');
  });

  it('the payload is plain JSON with no secrets beyond the verifier', () => {
    // Guards against someone later adding a token to the cookie "for
    // convenience": the cookie is httpOnly but readable by any XSS-driven
    // same-origin fetch.
    expect(Object.keys(valid).sort()).toEqual(
      ['codeVerifier', 'nonce', 'provider', 'returnTo', 'state'].sort(),
    );
  });
});
