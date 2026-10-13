/**
 * Email-verification unit tests — the token rules.
 *
 * The lifecycle (row creation, the gate, single use) needs Postgres and is
 * proven end-to-end by `make verify-d17` case T12. Here we test the parts a
 * silent regression would break without an error: the namespace that keeps
 * a reset token from verifying an account, and the link shape the
 * consuming page reads.
 *
 * The security-relevant assertion is the NAMESPACE DISTINCTION. Reset and
 * verification share one table; if both used the same identifier prefix, a
 * password-reset token would confirm an address (or vice versa), and
 * neither flow would look wrong until someone exploited it.
 */

import { describe, expect, it } from 'vitest';
import { hashToken } from '@/lib/auth/tokens';
import { identifierFor } from '@/lib/auth/reset-tokens';
import { VERIFY_PREFIX, verifyIdentifierFor, verifyLink } from '@/lib/auth/verify-tokens';

describe('verification token identifiers', () => {
  it('is case-insensitive on the email', () => {
    expect(verifyIdentifierFor('User@Example.COM')).toBe(verifyIdentifierFor('user@example.com'));
  });

  it('uses its own namespace', () => {
    expect(verifyIdentifierFor('a@b.c')).toBe(`${VERIFY_PREFIX}a@b.c`);
    expect(VERIFY_PREFIX).toBe('verify-email:');
  });

  it('cannot collide with a password-reset identifier for the same email', () => {
    // The load-bearing separation: one table, two meanings, no overlap.
    expect(verifyIdentifierFor('a@b.c')).not.toBe(identifierFor('a@b.c'));
  });
});

describe('verification link', () => {
  it('points at our own origin', () => {
    expect(new URL(verifyLink('t')).origin).toBe('http://127.0.0.1:3000');
  });

  it('carries the token as the PATH SEGMENT, which is what [token] reads', () => {
    const raw = 'raw-token-with-chars';
    const url = new URL(verifyLink(raw));

    expect(url.search).toBe('');
    expect(decodeURIComponent(url.pathname.replace('/verify-email/', ''))).toBe(raw);
  });

  it('round-trips URL-significant characters', () => {
    const raw = 'a/b+c=d?e&f';
    const url = new URL(verifyLink(raw));
    expect(decodeURIComponent(url.pathname.replace('/verify-email/', ''))).toBe(raw);
  });

  it('never leaks the token hash into the link', () => {
    const raw = 'some-raw-token';
    expect(verifyLink(raw)).not.toContain(hashToken(raw));
  });
});

describe('shared token primitives', () => {
  it('hashes with sha256 and never returns the raw value', () => {
    const stored = hashToken('raw');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain('raw');
  });
});
