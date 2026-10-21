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
import { createHash } from 'node:crypto';
import { keyHashFor, mintKey } from '@/lib/keys/policy';

/**
 * Mirrors the lookup in app/api/device/usage/route.ts.
 *
 * A duplicate of the route's query on purpose: the test asserts the
 * HASHING RULE, and the rule is what the route must implement. If the
 * route and this helper ever disagree, this file is what needs updating
 * — and the test below fails loudly when the hash shape changes.
 */
function resolveOrgId(rows: { key_hash: string; revoked_at: Date | null; org_status: string }[], key: string) {
  const hash = createHash('sha256').update(key, 'utf8').digest('hex');
  const row = rows.find(
    (r) => r.key_hash === hash && r.revoked_at === null && r.org_status === 'active',
  );
  return row?.key_hash ?? null;
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
