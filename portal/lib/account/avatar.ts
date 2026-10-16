/**
 * Avatar validation — pure rules, zero infrastructure.
 *
 * Same discipline as lib/keys/policy.ts: the rule that guards a write
 * lives in a module with no database import, so it can be unit-tested
 * anywhere. `lib/account/service.ts` calls `validateAvatarDataUrl` and
 * owns the write; this file decides what is acceptable.
 */

import { AccountError } from '@/lib/account/errors';

/**
 * Maximum decoded picture size. A 256 KiB PNG/JPEG at avatar display sizes
 * (32–96px) is generous; the cap exists so one row cannot bloat table scans
 * and backups. Enforced on DECODED bytes, not the base64 string (which runs
 * ~4/3 larger) — capping the string would let a smaller-looking payload
 * through.
 */
export const MAX_AVATAR_BYTES = 256 * 1024;

/** `data:image/<png|jpeg|webp>;base64,…` — the only accepted envelope. */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Validate a profile picture WITHOUT touching the database, so the rule is
 * unit-testable and the route rejects garbage before any write.
 *
 * Returns the normalised data URL, or null when `input` is null/undefined
 * (meaning "remove the picture"). Throws AccountError on anything else.
 *
 * Magic bytes are checked AFTER decoding because the prefix is a claim,
 * not proof: `data:image/png;base64,` followed by a JPEG still decodes,
 * and the decoder is what would choke on it later.
 */
export function validateAvatarDataUrl(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  const m = AVATAR_DATA_URL.exec(input.trim());
  if (!m || !m[1] || !m[2]) {
    throw new AccountError(
      'Picture must be a PNG, JPEG, or WebP image.',
      'validation',
      400,
      'image',
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(m[2], 'base64');
  } catch {
    throw new AccountError('Picture data is not valid base64.', 'validation', 400, 'image');
  }

  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
    throw new AccountError(
      `Pictures are limited to ${MAX_AVATAR_BYTES / 1024} KB.`,
      'validation',
      400,
      'image',
    );
  }

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) {
    throw new AccountError(
      'Picture content does not match its format.',
      'validation',
      400,
      'image',
    );
  }

  return `data:image/${m[1]};base64,${bytes.toString('base64')}`;
}
