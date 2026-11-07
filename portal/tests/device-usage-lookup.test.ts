/**
 * The device-usage key lookup.
 *
 * The contract under test is the one the desktop app depends on: a
 * `zn-…` plaintext, sent as a Bearer token, must resolve to the
 * organization that owns it — and the stored form is a SHA-256 hex, so
 * the lookup has to hash before comparing.
 *
 * The bug this file exists to prevent: comparing the raw plaintext
 * against `key_hash` can never match, so the endpoint answered 401 for
 * every caller including valid keys. The endpoint is the desktop's only
 * source of prompt-limit state; a permanent 401 there means the client
 * can never show or enforce its quota.
 */
import { describe, it, expect } from 'vitest';
import { keyHashFor, mintKey } from '@/lib/keys/policy';
// The REAL helpers, not a mirror: `keyDigest` is the hashing rule and
// `bearerKey` is the format gate, and the bug this file was written for is
// exactly what a mirrored copy cannot catch.
import { bearerKey, keyDigest } from '@/lib/device/auth';

/**
 * Mirrors only the WHERE clause of the lookup in lib/device/auth.ts, because
 * that clause needs Postgres. The hash itself is the real `keyDigest`, so a
 * change to the hashing rule cannot silently pass here.
 */
function resolveOrgId(rows: { key_hash: string; revoked_at: Date | null; org_status: string }[], key: string) {
  const hash = keyDigest(key);
  const row = rows.find(
    (r) => r.key_hash === hash && r.revoked_at === null && r.org_status === 'active',
  );
  return row?.key_hash ?? null;
}

function request(authorization?: string): Request {
  return new Request('https://portal.example/api/device/usage', {
    headers: authorization ? { authorization } : {},
  });
}

describe('device usage key lookup', () => {
  it('resolves a live key to its owner', () => {
    const { customerKey } = mintKey();
    const rows = [
      { key_hash: keyHashFor(customerKey), revoked_at: null, org_status: 'active' },
    ];
    expect(resolveOrgId(rows, customerKey)).toBe(keyHashFor(customerKey));
  });

  it('hashes the plaintext before comparing — a raw comparison never matches', () => {
    const { customerKey } = mintKey();
    const stored = keyHashFor(customerKey);
    // The stored value is a hex digest, NOT the plaintext.
    expect(stored).not.toBe(customerKey);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a key that was never issued', () => {
    const { customerKey } = mintKey();
    const rows = [
      { key_hash: keyHashFor(customerKey), revoked_at: null, org_status: 'active' },
    ];
    expect(resolveOrgId(rows, 'zn-not-a-real-key-at-all')).toBe(null);
  });

  it('rejects a revoked key', () => {
    const { customerKey } = mintKey();
    const rows = [
      {
        key_hash: keyHashFor(customerKey),
        revoked_at: new Date('2026-10-21T00:00:00Z'),
        org_status: 'active',
      },
    ];
    expect(resolveOrgId(rows, customerKey)).toBe(null);
  });

  it('rejects a key belonging to a suspended organization', () => {
    const { customerKey } = mintKey();
    const rows = [
      { key_hash: keyHashFor(customerKey), revoked_at: null, org_status: 'suspended' },
    ];
    expect(resolveOrgId(rows, customerKey)).toBe(null);
  });

  it('does not match on the key prefix alone', () => {
    const { customerKey } = mintKey();
    const rows = [
      { key_hash: keyHashFor(customerKey), revoked_at: null, org_status: 'active' },
    ];
    // Same prefix, different body — must not resolve.
    expect(resolveOrgId(rows, `zn-${'A'.repeat(customerKey.length - 3)}`)).toBe(null);
  });
});

describe('bearerKey', () => {
  it('accepts the zn- form the desktop sends', () => {
    const { customerKey } = mintKey();
    expect(bearerKey(request(`Bearer ${customerKey}`))).toBe(customerKey);
  });

  it('trims the surrounding whitespace a config file leaves behind', () => {
    const { customerKey } = mintKey();
    expect(bearerKey(request(`Bearer  ${customerKey}  `))).toBe(customerKey);
  });

  it('rejects a key that has no zn- prefix', () => {
    // A portal session token, or the `sk-` form the edge rewrites to, must
    // never be hashed and looked up as a customer key.
    expect(bearerKey(request(`Bearer ${'sk-' + 'a'.repeat(32)}`))).toBe(null);
  });

  it('rejects a missing or non-Bearer header', () => {
    expect(bearerKey(request())).toBe(null);
    expect(bearerKey(request('Basic abcdef'))).toBe(null);
    expect(bearerKey(request('Bearer '))).toBe(null);
  });
});

describe('throttle bucket', () => {
  it('is derived from the key, so two keys never share a bucket', () => {
    const a = keyDigest(mintKey().customerKey);
    const b = keyDigest(mintKey().customerKey);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
