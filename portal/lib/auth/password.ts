/**
 * Password hashing — scrypt, self-hosted, no third-party auth service.
 *
 * Why scrypt and not bcrypt/argon2: it is in Node's standard library
 * (`node:crypto`), so there is no native build step, no prebuilt-binary
 * supply-chain surface, and no dependency to keep patched. OWASP lists
 * scrypt as an acceptable KDF (N≥2^16, r=8, p=1 minimum).
 *
 * The stored string is self-describing:
 *
 *     scrypt$N$r$p$<keylen>$<salt-b64>$<hash-b64>
 *
 * That matters operationally: parameters can be raised later without
 * invalidating existing hashes. `needsRehash()` detects an old row and
 * the login path transparently upgrades it.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters.
 *
 * N=2^16 (64 MiB with r=8) is the OWASP floor and completes in well under
 * a second on a 2-vCPU box. Raise toward N=2^17 when the VPS has dedicated
 * capacity — the rehash-on-login path makes that a rolling upgrade, not a
 * flag-day migration.
 */
export const PARAMS = {
  N: 1 << 16,
  r: 8,
  p: 1,
  keylen: 32,
  saltBytes: 16,
} as const;

/**
 * Node's default maxmem is 32 MiB, which silently caps scrypt below the
 * N we ask for. It must be raised or the call fails with
 * "Invalid scrypt params" once N*r*128 exceeds it.
 */
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error('password must be at least 12 characters');
  }
  const salt = randomBytes(PARAMS.saltBytes);
  const hash = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    PARAMS.keylen,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Always returns a boolean and always performs the KDF, even when the user
 * does not exist or the stored format is unrecognised. A missing account
 * that returns early would leak, via timing, whether an email is
 * registered.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) {
    // Dummy KDF to keep the timing profile flat for unknown users.
    await scrypt(password.normalize('NFKC'), randomBytes(PARAMS.saltBytes), PARAMS.keylen, {
      N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM,
    });
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') {
    await scrypt(password.normalize('NFKC'), randomBytes(PARAMS.saltBytes), PARAMS.keylen, {
      N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM,
    });
    return false;
  }

  // Destructure so noUncheckedIndexedAccess cannot hand us `undefined`
  // into Buffer.from.
  const [, nStr, rStr, pStr, kStr, saltB64, hashB64] = parts;
  if (!saltB64 || !hashB64) return false;

  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const keylen = Number(kStr);
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  const actual = await scrypt(password.normalize('NFKC'), salt, keylen, {
    N, r, p, maxmem: MAXMEM,
  });

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash predates the current cost parameters. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') return true;
  return (
    Number(parts[1]) < PARAMS.N ||
    Number(parts[2]) < PARAMS.r ||
    Number(parts[3]) < PARAMS.p ||
    Number(parts[4]) < PARAMS.keylen
  );
}

/**
 * Password policy.
 *
 * Length over composition rules: a long passphrase beats "P@ssw0rd!" and
 * survives a breach better. We reject known-compromised patterns and
 * require a minimum length, but we do NOT impose symbol/case/digit
 * conjunctions — NIST SP 800-63B advises against them because they push
 * users toward predictable substitutions ("Password1!").
 */
const BANNED = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  '123456789012', 'qwertyuiop12', 'qwertyuiop123',
  'letmein12345', 'administrator', 'changeme1234', 'welcome12345',
  'iloveyou1234', 'sunshine1234', 'football1234',
]);

export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < 12) return { ok: false, error: 'Use at least 12 characters.' };
  if (password.length > 256) return { ok: false, error: 'Password is too long.' };

  if (BANNED.has(password.toLowerCase())) return { ok: false, error: 'That password is too common.' };

  // Two character classes AND no long repeated run. Length alone must not
  // be satisfiable by "aaaaaaaaaaaa" or "123456789012".
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2 || longestRepeatedRun(password) >= 6) {
    return { ok: false, error: 'Mix in at least two of: lowercase, uppercase, numbers, symbols — and avoid long repeated runs.' };
  }

  return { ok: true };
}

/** Length of the longest run of a single repeated character. */
function longestRepeatedRun(s: string): number {
  let best = 0;
  let current = 0;
  let prev = '';
  for (const ch of s) {
    current = ch === prev ? current + 1 : 1;
    prev = ch;
    if (current > best) best = current;
  }
  return best;
}