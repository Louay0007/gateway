/**
 * The post-payment destination rule.
 *
 * This exists because `safeReturnPath` had been copy-pasted into the
 * checkout page and the dev-pay action, and both copies accepted
 * `/\evil.com` — a value a browser trims to `//evil.com`. A payment
 * redirect is the one place where a one-character miss is a phishing
 * primitive, so the rule is asserted rather than reviewed.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_RETURN_PATH, safeReturnPath } from '@/lib/billing/state';

describe('safeReturnPath', () => {
  it('keeps a same-site path', () => {
    expect(safeReturnPath('/settings?tab=plan')).toBe('/settings?tab=plan');
    expect(safeReturnPath('/dashboard/billing')).toBe('/dashboard/billing');
    expect(safeReturnPath('/chat/abc-123')).toBe('/chat/abc-123');
  });

  it('falls back when nothing was asked for', () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath('')).toBe(DEFAULT_RETURN_PATH);
  });

  it('refuses an absolute URL', () => {
    expect(safeReturnPath('https://evil.example/steal')).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath('http://evil.example')).toBe(DEFAULT_RETURN_PATH);
    // No scheme, no leading slash: still not a path on this site.
    expect(safeReturnPath('evil.example')).toBe(DEFAULT_RETURN_PATH);
  });

  it('refuses a protocol-relative URL', () => {
    expect(safeReturnPath('//evil.example/steal')).toBe(DEFAULT_RETURN_PATH);
  });

  it('refuses the backslash form a browser trims to protocol-relative', () => {
    // `/\evil.example` survives a bare `startsWith('//')` check but browsers
    // normalise the backslash, so it navigates off-site.
    expect(safeReturnPath('/\\evil.example')).toBe(DEFAULT_RETURN_PATH);
  });

  it('allows a query string that merely mentions a URL', () => {
    // The value is only dangerous when it controls the ORIGIN. A parameter
    // that happens to contain a URL is still a path on this site.
    expect(safeReturnPath('/settings?next=https://evil.example')).toBe(
      '/settings?next=https://evil.example',
    );
  });
});
