/**
 * The `zn-` key format, end to end at the pure-function level.
 *
 * The property under test is not "keys start with zn-" but the thing that
 * makes that safe: the customer key and the stored gateway key are the SAME
 * body, so the edge is substituting a 3-character prefix and nothing else.
 * If that ever stopped being true, every key in the field would silently
 * fail at the customer's first request.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CUSTOM_KEY_PREFIX,
  GATEWAY_KEY_PREFIX,
  MIN_KEY_BODY_LENGTH,
  isWellFormedCustomerKey,
  keyHashFor,
  keyPrefixFor,
  KEY_PREFIX_LENGTH,
  mintKey,
  toCustomerKey,
  toGatewayKey,
} from '@/lib/keys/policy';

const body = (key: string) => key.slice(CUSTOM_KEY_PREFIX.length);

describe('key format', () => {
  it('every minted key starts with the customer prefix', () => {
    for (let i = 0; i < 200; i++) {
      expect(mintKey().customerKey.startsWith(CUSTOM_KEY_PREFIX)).toBe(true);
    }
  });

  it('never mints the same body twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(mintKey().customerKey);
    expect(seen.size).toBe(500);
  });

  it('shares ONE body between the two forms — this is the whole invariant', () => {
    const { customerKey, gatewayKey } = mintKey();
    expect(body(customerKey)).toBe(body(gatewayKey));
    expect(gatewayKey).toBe(GATEWAY_KEY_PREFIX + body(customerKey));
  });

  it('produces a key the gateway will accept', () => {
    // LiteLLM: 16–100 chars, ^sk-[A-Za-z0-9_-]+$ (is_valid_api_key), and
    // MINIMUM_CUSTOM_KEY_LENGTH=16. Asserted here so a change to the body
    // alphabet cannot quietly produce keys the gateway rejects.
    for (let i = 0; i < 100; i++) {
      const { gatewayKey } = mintKey();
      expect(gatewayKey).toMatch(/^sk-[A-Za-z0-9_-]+$/);
      expect(gatewayKey.length).toBeGreaterThanOrEqual(16);
      expect(gatewayKey.length).toBeLessThanOrEqual(100);
    }
  });

  it('carries enough entropy to be unguessable', () => {
    // 32 random bytes. If this drops, keys become brute-forceable.
    expect(body(mintKey().customerKey).length).toBeGreaterThanOrEqual(40);
    expect(body(mintKey().customerKey).length).toBeGreaterThanOrEqual(MIN_KEY_BODY_LENGTH);
  });
});

describe('toGatewayKey — the edge rewrite', () => {
  it('restores the gateway prefix', () => {
    expect(toGatewayKey('zn-abcdefghijklmnop')).toBe('sk-abcdefghijklmnop');
  });

  it('round-trips back to the customer form', () => {
    const { customerKey } = mintKey();
    expect(toCustomerKey(toGatewayKey(customerKey))).toBe(customerKey);
  });

  it('only touches the LEADING prefix', () => {
    // A body may legitimately contain 'zn-' (base64url has no '-' before
    // 'zn', but an operator-supplied value could). The substitution must be
    // anchored.
    expect(toGatewayKey('zn-aaanz-bbzn-cc')).toBe('sk-aaanz-bbzn-cc');
  });

  it('leaves a key issued before this format working', () => {
    // Backwards compatibility: `sk-` keys already in the field must keep
    // authenticating, or every existing integration breaks on deploy.
    expect(toGatewayKey('sk-legacykey0123456789')).toBe('sk-legacykey0123456789');
  });

  it('leaves anything else exactly as it found it', () => {
    for (const v of [
      'Bearer sk-master0123456789012345',
      'hashed-jwt-abc123',
      'eyJhbGciOiJIUzI1NiJ9.abc.def',
      '',
      'garbage',
    ]) {
      expect(toGatewayKey(v)).toBe(v);
    }
  });
});

describe('isWellFormedCustomerKey', () => {
  it('rejects a prefix with no usable body', () => {
    expect(isWellFormedCustomerKey('zn-')).toBe(false);
    expect(isWellFormedCustomerKey('zn-short')).toBe(false);
    expect(isWellFormedCustomerKey('zn-' + 'a'.repeat(MIN_KEY_BODY_LENGTH - 1))).toBe(false);
  });

  it('accepts a real one', () => {
    expect(isWellFormedCustomerKey(mintKey().customerKey)).toBe(true);
  });

  it('defers on values that are not ours', () => {
    // The gateway rejects non-zn credentials, not the edge.
    expect(isWellFormedCustomerKey('sk-legacy0123456789')).toBe(true);
  });
});

describe('what is stored and displayed', () => {
  it('displays the customer prefix, so a table row is branded', () => {
    const { customerKey } = mintKey();
    const prefix = keyPrefixFor(customerKey);
    expect(prefix.startsWith(CUSTOM_KEY_PREFIX)).toBe(true);
    expect(prefix).toHaveLength(KEY_PREFIX_LENGTH);
    expect(customerKey.startsWith(prefix)).toBe(true);
  });

  it('never stores the plaintext in either form', () => {
    const { customerKey, gatewayKey } = mintKey();
    const stored = keyHashFor(customerKey);
    expect(stored).not.toContain(customerKey);
    expect(stored).not.toContain(body(customerKey));
    expect(stored).toHaveLength(64);
    // The two forms do NOT hash alike: the prefix is part of the hashed
    // input. Pinned deliberately, because the instinct that "same body ⇒
    // same hash" is wrong and would produce a real bug the moment anyone
    // tried to verify a presented `zn-` key against the gateway's own hash.
    // The portal's key_hash is the hash of the CUSTOMER form; LiteLLM keeps
    // its own `sha256(sk-…)` in `litellm_key_hash`, and nothing compares
    // the two.
    expect(keyHashFor(customerKey)).not.toBe(keyHashFor(toGatewayKey(customerKey)));
    expect(stored).toBe(createHash('sha256').update(customerKey).digest('hex'));
  });

  it('keeps the display prefix short enough not to leak the key', () => {
    const { customerKey } = mintKey();
    expect(keyPrefixFor(customerKey)).not.toBe(customerKey);
    expect(customerKey.startsWith(keyPrefixFor(customerKey))).toBe(true);
  });
});