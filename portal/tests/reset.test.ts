/**
 * Password-reset unit tests — the token rules.
 *
 * The lifecycle itself (row creation, single use, expiry, the actual
 * password change) needs Postgres and is verified end-to-end against the
 * live stack, the same way the money path is: the reset flow is checked
 * live with the log transport (request → link → complete → sign in),
 * because a fake database proves nothing about a recovery path.
 *
 * What is testable WITHOUT a database is here: the identifier contract,
 * the hashing rule, and the link's shape — the parts where a silent
 * regression (case sensitivity, a stored plaintext, a wrong origin)
 * would break every reset without an error.
 */

import { describe, expect, it } from 'vitest';
import { hashToken, identifierFor, resetLink } from '@/lib/auth/reset-tokens';

describe('reset token identifiers', () => {
  it('is case-insensitive on the email so a mixed-case request finds the row', () => {
    expect(identifierFor('User@Example.COM')).toBe(identifierFor('user@example.com'));
  });

  it('namespaces the row so it never collides with other token kinds', () => {
    expect(identifierFor('a@b.c')).toBe('password-reset:a@b.c');
  });
});

describe('reset token hashing', () => {
  it('stores a hash, never the raw token', () => {
    const raw = 'a-realistically-long-random-token';
    const stored = hashToken(raw);

    expect(stored).not.toContain(raw);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable, so the same submitted token resolves the same row', () => {
    expect(hashToken('token')).toBe(hashToken('token'));
  });

  it('distinguishes tokens that differ, so a guess cannot resolve', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('is one-way: knowing the hash gives nothing back', () => {
    // sha256 of the empty string is a public constant — a regression to
    // storing raw tokens would be visible as stored !== hash(raw).
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('reset link', () => {
  it('points at our own origin', () => {
    expect(new URL(resetLink('some-token')).origin).toBe('http://127.0.0.1:3000');
  });

  it('carries the token as the PATH SEGMENT, which is what [token] reads', () => {
    // The consuming page is app/reset-password/[token]/page.tsx. A query
    // parameter here silently resolved to params.token === "confirm" and
    // every emailed link submitted the wrong value. This asserts the
    // segment, not a literal path that happens to look right.
    const raw = 'raw-token-with-chars';
    const url = new URL(resetLink(raw));

    expect(url.search).toBe('');
    expect(decodeURIComponent(url.pathname.replace('/reset-password/', ''))).toBe(raw);
  });

  it('inserts the token verbatim, with no encoding of its own', () => {
    // The page reads `params.token`, which Next has ALREADY decoded. If this
    // function encoded as well, the page would receive a doubly-encoded
    // value and every link would fail with "invalid or expired" — the exact
    // bug both flows were written to avoid. Real tokens are
    // randomBytes(32).toString('base64url') = [A-Za-z0-9_-], which is safe
    // as a path segment; a token with '/' or '?' could not round-trip
    // through one whatever we did here, so that is not the contract.
    const raw = 'aB3-_xY9';
    expect(resetLink(raw).endsWith(`/reset-password/${raw}`)).toBe(true);
  });

  it('never leaks the token hash into the link', () => {
    const raw = 'some-raw-token';
    expect(resetLink(raw)).not.toContain(hashToken(raw));
  });
});
