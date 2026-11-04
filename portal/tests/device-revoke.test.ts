/**
 * The device-authenticated revoke route.
 *
 * The contract: a `zn-…` plaintext sent as a Bearer token is both the
 * credential being revoked and the proof of ownership, because there is no
 * browser session to check. Two properties matter and both are easy to get
 * wrong in opposite directions:
 *
 *   1. HASH BEFORE COMPARING. `api_keys.key_hash` stores SHA-256 hex, never
 *      the plaintext. A route that compares the raw bearer can never match,
 *      so it answers 401 for every caller — the same bug the device-usage
 *      lookup already had.
 *
 *   2. NEVER TRUST A KEY ID FROM THE CLIENT. The route derives the row from
 *      the presented hash alone. If it ever accepted an id from the body, any
 *      key could revoke any other.
 *
 * The route itself imports the database, so these cases exercise the lookup
 * rule the route implements rather than the HTTP handler.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { keyHashFor } from '@/lib/keys/policy';

interface KeyRow {
  id: string;
  key_hash: string;
  litellm_key_hash: string | null;
  revoked_at: Date | null;
}

/** Mirrors `credentialFor` in app/api/device/revoke/route.ts. */
function resolveCredential(rows: KeyRow[], bearer: string): KeyRow | null {
  const hash = createHash('sha256').update(bearer, 'utf8').digest('hex');
  return rows.find((row) => row.key_hash === hash) ?? null;
}

const KEY = 'zn-abcdefghijklmnopqrstuvwxyz';

function rows(): KeyRow[] {
  return [
    { id: 'key-fast', key_hash: keyHashFor(KEY), litellm_key_hash: 'lit-1', revoked_at: null },
    {
      id: 'key-other',
      key_hash: keyHashFor('zn-otherkeyotherkeyother'),
      litellm_key_hash: 'lit-2',
      revoked_at: null,
    },
  ];
}

describe('device revoke credential lookup', () => {
  it('resolves the key whose plaintext hashes to the stored hash', () => {
    expect(resolveCredential(rows(), KEY)?.id).toBe('key-fast');
  });

  it('does not match when the plaintext is compared directly', () => {
    // Guards the exact bug: raw plaintext can never equal the stored hash.
    const stored = rows()[0]!.key_hash;
    expect(stored).not.toBe(KEY);
    expect(stored).toBe(createHash('sha256').update(KEY).digest('hex'));
  });

  it('resolves nothing for a key that was never issued', () => {
    expect(resolveCredential(rows(), 'zn-unknowableunknowable')).toBeNull();
  });

  it('resolves nothing for a non-zn bearer', () => {
    expect(resolveCredential(rows(), 'sk-somethingelse')).toBeNull();
  });

  it('cannot be steered to another key by an id-shaped bearer', () => {
    // A client that sends a key id instead of a key must not match anything.
    expect(resolveCredential(rows(), 'key-other')).toBeNull();
  });

  it('still resolves an already-revoked key, so sign-out is idempotent', () => {
    // The route treats an already-revoked row as success rather than 409: the
    // app retries sign-out after a network failure and must not have to tell
    // "already revoked" apart from "never existed".
    const revoked = rows().map((row) => ({ ...row, revoked_at: new Date() }));
    expect(resolveCredential(revoked, KEY)?.id).toBe('key-fast');
  });
});
