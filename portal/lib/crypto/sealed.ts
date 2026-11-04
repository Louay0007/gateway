/**
 * Sealed values — AES-256-GCM, one random IV per record.
 *
 * WHY THIS EXISTS. `lib/auth/password.ts` is scrypt (one-way) and
 * `lib/auth/device/policy.ts` is HMAC (one-way). Both are correct for
 * credentials the server never needs back. The org's LiteLLM chat key is
 * different: it must be PRESENTED to the gateway on every single request,
 * so it has to be reversible, and a hash is not.
 *
 * The envelope, and why each field is there:
 *
 *     v1:<iv b64>:<tag b64>:<ciphertext b64>
 *
 *   `v1:`   a version prefix, so a future algorithm can coexist with
 *           existing rows instead of requiring a Big-Bang re-encrypt of
 *           live conversations. `open` refuses an unknown version rather
 *           than guessing.
 *   iv      random, 12 bytes, fresh per record. Reusing an IV under the
 *           same key breaks GCM catastrophically (it leaks the XOR of
 *           both plaintexts and, worse, the auth subkey). There is no
 *           deterministic mode here on purpose.
 *   tag     GCM's authentication tag. Without it the column is malleable,
 *           and a flipped bit in a key is not a wrong key — it is a
 *           silent request replayed under someone else's credential.
 *
 * KEY SOURCE. `CHAT_KEY_SECRET`, base64, 32 bytes — a NEW variable, not
 * derived from `AUTH_SECRET`. Rotating a session secret signs everyone
 * out, which must never also make every stored chat key undecryptable.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM is defined for 96-bit IVs; anything else costs a GHASH pass
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export class SealedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedError';
  }
}

/**
 * Read the key from the environment, once per call.
 *
 * Not cached in module scope: this file is imported by a route handler
 * that may be evaluated at build time (where the variable is absent) and
 * again at runtime (where it must be present). Reading it lazily means a
 * build never fails over a secret it does not need.
 *
 * A malformed secret THROWS rather than falling back to something
 * derived. A fallback would silently encrypt production rows with a
 * guessable key, and nothing downstream could tell.
 */
function secret(): Buffer {
  const raw = process.env.CHAT_KEY_SECRET;
  if (!raw) {
    throw new SealedError(
      'CHAT_KEY_SECRET is not set. Generate one with: openssl rand -base64 32',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SealedError(
      `CHAT_KEY_SECRET must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/** True when the secret is present and the right shape — for `/api/health`. */
export function sealedAvailable(): boolean {
  try {
    secret();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt to the `v1:` envelope. Every call uses a fresh IV. */
export function seal(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, secret(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Stored as bytes, not a string: the column is bytea and this keeps the
  // three parts unambiguous without a second encoding layer.
  return Buffer.from(
    `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`,
    'utf8',
  );
}

/**
 * Decrypt. Throws on ANY tampering — a wrong key, a flipped ciphertext
 * byte, a truncated envelope. GCM's whole point is that these are not
 * distinguishably "wrong key" vs "corrupted": both mean refuse.
 */
export function open(sealed: Buffer): string {
  const text = sealed.toString('utf8');
  if (!text.startsWith(PREFIX)) {
    throw new SealedError('Sealed value has no recognised version prefix.');
  }

  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new SealedError('Sealed value is malformed.');
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SealedError('Sealed value has an invalid IV or tag length.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, secret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (e) {
    // Do not forward node's message: "Unsupported state or unable to
    // authenticate data" is true and useless, and the real cause (wrong
    // key vs tampered row) is a deployment question, not a caller's.
    throw new SealedError('Could not open sealed value: authentication failed.');
  }
}

/** Constant-time comparison for secrets compared outside a cipher. */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
