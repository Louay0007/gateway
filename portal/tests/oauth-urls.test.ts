/**
 * The canonical origin and the callback URL — the values that must match the
 * provider console byte for byte.
 *
 * WHY THIS FILE EXISTS. Found live in production, not by reading:
 *
 *   curl https://zaino.soon.it/api/oauth/google/start
 *   → 307 https://0.0.0.0:3000/sign-in?social=unavailable
 *
 * `new URL(path, request.url)` uses the origin the Node server sees, which
 * behind Caddy is the container's own bind address. The user got sent to a
 * host that does not exist. Two separate consequences are tested here:
 *
 *   1. our own redirects must land on the public origin
 *   2. the `redirect_uri` sent to the provider must be identical on the
 *      authorization request and on the token exchange — providers compare
 *      them, and a mismatch is rejected AFTER the user has consented
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { canonicalOrigin, callbackUrlFor } from '@/lib/auth/oauth/urls';

const BRIDGE_URL = 'http://0.0.0.0:3000/api/oauth/google/start';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Set the two env vars `canonicalOrigin` reads, and nothing else. */
function setEnv(authUrl?: string, appUrl?: string) {
  vi.stubEnv('AUTH_URL', authUrl ?? '');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl ?? '');
}

describe('canonicalOrigin', () => {
  it('prefers AUTH_URL over the request origin (the production case)', () => {
    setEnv('https://zaino.soon.it');
    // The bridge address is what the request actually carries.
    expect(canonicalOrigin(BRIDGE_URL)).toBe('https://zaino.soon.it');
  });

  it('falls back to NEXT_PUBLIC_APP_URL when AUTH_URL is unset', () => {
    setEnv(undefined, 'https://zaino.soon.it');
    expect(canonicalOrigin(BRIDGE_URL)).toBe('https://zaino.soon.it');
  });

  it('falls back to the request origin when neither is set (local dev)', () => {
    setEnv(undefined, undefined);
    expect(canonicalOrigin('http://localhost:3000/api/oauth/google/start')).toBe(
      'http://localhost:3000',
    );
  });

  it('strips a trailing slash so the origin never becomes "//path"', () => {
    setEnv('https://zaino.soon.it/');
    expect(canonicalOrigin(BRIDGE_URL)).toBe('https://zaino.soon.it');
    setEnv('https://zaino.soon.it///');
    expect(canonicalOrigin(BRIDGE_URL)).toBe('https://zaino.soon.it');
  });

  it('trims whitespace from a copy-pasted env value', () => {
    setEnv('  https://zaino.soon.it  ');
    expect(canonicalOrigin(BRIDGE_URL)).toBe('https://zaino.soon.it');
  });

  it('ignores a blank env value rather than producing an empty origin', () => {
    setEnv('   ', '   ');
    expect(canonicalOrigin('https://zaino.soon.it/x')).toBe('https://zaino.soon.it');
  });
});

describe('callbackUrlFor', () => {
  it('builds the exact path each provider console must be given', () => {
    setEnv('https://zaino.soon.it');
    expect(callbackUrlFor(BRIDGE_URL, 'google')).toBe(
      'https://zaino.soon.it/api/oauth/google/callback',
    );
    expect(callbackUrlFor(BRIDGE_URL, 'github')).toBe(
      'https://zaino.soon.it/api/oauth/github/callback',
    );
    expect(callbackUrlFor(BRIDGE_URL, 'apple')).toBe(
      'https://zaino.soon.it/api/oauth/apple/callback',
    );
  });

  it('has NO trailing slash — providers compare the string exactly', () => {
    setEnv('https://zaino.soon.it');
    expect(callbackUrlFor(BRIDGE_URL, 'google').endsWith('/callback')).toBe(true);
    expect(callbackUrlFor(BRIDGE_URL, 'google')).not.toMatch(/\/$/);
  });

  it('is IDENTICAL for the start and callback routes', () => {
    // The property that matters. `start` builds it from its own request,
    // `callback` from its own, and the two requests arrive on different
    // paths — if either used its raw origin they would disagree.
    setEnv('https://zaino.soon.it');
    const fromStart = callbackUrlFor('http://0.0.0.0:3000/api/oauth/google/start', 'google');
    const fromCallback = callbackUrlFor('http://0.0.0.0:3000/api/oauth/google/callback', 'google');
    expect(fromStart).toBe(fromCallback);
  });

  it('works for localhost with no configuration', () => {
    setEnv(undefined, undefined);
    expect(callbackUrlFor('http://localhost:3000/api/oauth/google/start', 'google')).toBe(
      'http://localhost:3000/api/oauth/google/callback',
    );
  });

  it('never produces a 0.0.0.0 origin when AUTH_URL is set', () => {
    // The exact production failure, pinned.
    setEnv('https://zaino.soon.it');
    const url = callbackUrlFor(BRIDGE_URL, 'google');
    expect(url).not.toContain('0.0.0.0');
    expect(url.startsWith('https://zaino.soon.it/')).toBe(true);
  });
});
