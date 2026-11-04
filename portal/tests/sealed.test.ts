/**
 * Sealed values — the round trip, and the ways it must refuse.
 *
 * The happy path is one assertion. The rest of this file exists because a
 * reversible credential is a different risk class from a hashed one: if
 * `open` ever returns a plaintext it should have rejected, the gateway
 * receives a bad key and the failure is silent (a 401 deep inside a
 * stream), not a crash at the call site.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, sealedAvailable, SealedError } from '@/lib/crypto/sealed';

const VALID = randomBytes(32).toString('base64');

describe('sealed', () => {
  const original = process.env.CHAT_KEY_SECRET;

  beforeEach(() => {
    process.env.CHAT_KEY_SECRET = VALID;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CHAT_KEY_SECRET;
    else process.env.CHAT_KEY_SECRET = original;
  });

  it('round-trips a plaintext unchanged', () => {
    const plaintext = 'sk-' + randomBytes(32).toString('base64url');
    expect(open(seal(plaintext))).toBe(plaintext);
  });

  it('round-trips UTF-8 and the empty string', () => {
    for (const value of ['', 'clé-arabe-مرحبا', 'line\nbreak\tand tab']) {
      expect(open(seal(value))).toBe(value);
    }
  });

  it('carries the v1 envelope so a future algorithm can coexist', () => {
    expect(seal('x').toString('utf8').startsWith('v1:')).toBe(true);
  });

  it('uses a FRESH IV per call — the same plaintext seals differently', () => {
    // If this ever fails, GCM's IV reuse leaks the XOR of two plaintexts
    // and destroys the authentication key. It is the one property whose
    // failure is unrecoverable and undetectable after the fact.
    const a = seal('same').toString('utf8');
    const b = seal('same').toString('utf8');
    expect(a).not.toBe(b);
    const iv = (s: string) => s.split(':')[1];
    expect(iv(a)).not.toBe(iv(b));
  });

  it('refuses a tampered ciphertext', () => {
    const sealed = seal('original').toString('utf8');
    const [prefix, iv, tag, ct] = sealed.split(':') as [string, string, string, string];
    const bytes = Buffer.from(ct, 'base64');
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0x01, 0);
    const tampered = Buffer.from(`${prefix}:${iv}:${tag}:${bytes.toString('base64')}`);
    expect(() => open(tampered)).toThrow(SealedError);
  });

  it('refuses a tampered tag', () => {
    const [prefix, iv, , ct] = seal('original').toString('utf8').split(':') as [
      string,
      string,
      string,
      string,
    ];
    const tag = randomBytes(16).toString('base64');
    expect(() => open(Buffer.from(`${prefix}:${iv}:${tag}:${ct}`))).toThrow(SealedError);
  });

  it('refuses a sealed value written under a DIFFERENT key', () => {
    const sealed = seal('portable?');
    process.env.CHAT_KEY_SECRET = randomBytes(32).toString('base64');
    // This is the rotation case: a new CHAT_KEY_SECRET must make old rows
    // fail loudly, not decode into something plausible.
    expect(() => open(sealed)).toThrow(SealedError);
  });

  it('refuses an unknown version prefix rather than guessing', () => {
    const sealed = seal('x').toString('utf8').replace(/^v1:/, 'v2:');
    expect(() => open(Buffer.from(sealed))).toThrow(/version prefix/);
  });

  it('refuses a malformed envelope', () => {
    for (const bad of ['v1:', 'v1:only', 'v1:a:b', 'nonsense']) {
      expect(() => open(Buffer.from(bad))).toThrow(SealedError);
    }
  });

  it('throws on a missing secret instead of falling back to a guess', () => {
    delete process.env.CHAT_KEY_SECRET;
    expect(sealedAvailable()).toBe(false);
    expect(() => seal('x')).toThrow(/CHAT_KEY_SECRET is not set/);
  });

  it('throws on a secret of the wrong length', () => {
    process.env.CHAT_KEY_SECRET = randomBytes(16).toString('base64');
    expect(sealedAvailable()).toBe(false);
    expect(() => seal('x')).toThrow(/32 bytes/);
  });
});
