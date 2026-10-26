/**
 * D17 payment configuration + pure rules.
 *
 * Pure by design, like lib/entitlements/policy.ts and
 * lib/auth/reset-tokens.ts: every rule that protects this payment path
 * (what an authorization number looks like, how much to transfer, when
 * the window closes) must be unit-testable without Postgres, a
 * filesystem, or an email account.
 *
 * Config is read from the environment at call time (not module load) so
 * a test can change it and so nothing throws at import.
 */

/** Max screenshot size. Anything larger is refused before it is read twice. */
export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;

/** Allowed screenshot types, verified by CONTENT (magic bytes), never by the client's MIME string. */
export const SCREENSHOT_MAGIC: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function detectScreenshotType(buffer: Buffer): { mime: string; ext: string } | null {
  return SCREENSHOT_MAGIC.find((m) => m.test(buffer)) ?? null;
}

/**
 * Receiver phone, as configured. Never hardcoded: a number in source is
 * a number that is wrong the day the merchant changes it.
 */
export function d17ReceiverPhone(): string {
  return (process.env.D17_RECEIVER_PHONE ?? '').trim();
}

/** Payment window in hours. Default 24. */
export function paymentWindowHours(): number {
  const raw = Number(process.env.PAYMENT_WINDOW_HOURS ?? '24');
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return Math.min(raw, 24 * 30);
}

/**
 * Authorization-number format, configurable because D17 does not
 * document it. Tighten this the day real examples exist — until then a
 * permissive-but-bounded pattern is the honest default.
 */
export function authNumberPattern(): RegExp {
  const raw = (process.env.AUTH_NUMBER_REGEX ?? '^[A-Za-z0-9]{4,32}$').trim();
  try {
    return new RegExp(raw);
  } catch {
    return /^[A-Za-z0-9]{4,32}$/;
  }
}

export function isValidAuthNumber(normalized: string): boolean {
  const pattern = authNumberPattern();
  // Bounded regardless of the configured pattern: a regex that matches
  // everything (or nothing) must not silently change the data shape.
  if (normalized.length < 4 || normalized.length > 64) return false;
  return pattern.test(normalized);
}

/** Trim + uppercase. The stored form and the uniqueness both use it. */
export function normalizeAuthNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Tunisian mobile: 8 digits, with or without a +216 country prefix and
 * any spacing. Stored in the 8-digit local form.
 */
export function normalizeSenderPhone(raw: string): string | null {
  const stripped = raw.replace(/[\s.\-()]/g, '');
  const withoutCountry =
    stripped.startsWith('+216') ? stripped.slice(4)
    : stripped.startsWith('00216') ? stripped.slice(5)
    : stripped;
  return /^\d{8}$/.test(withoutCountry) ? withoutCountry : null;
}

/** USD price (cents) → TND amount in millimes, using the configured rate. */
export function amountTndMillimes(usdCents: number, rate = usdTndRate()): number {
  const tnd = (usdCents / 100) * rate;
  return Math.round(tnd * 1000);
}

/**
 * USD plan price (cents) → the TND amount a D17 transfer asks for.
 *
 * Plans are advertised and collected in WHOLE dinars: 50 DT / 90 DT, and
 * 35 DT / 63 DT during a sale. Converting the catalog's USD cents keeps a
 * single source of truth while rounding the cash request to the amount the
 * customer saw on the pricing page (no 49.972-style transfers).
 */
export function planPriceTndMillimes(usdCents: number, rate = usdTndRate()): number {
  return Math.round((usdCents / 100) * rate) * 1000;
}

export function usdTndRate(): number {
  const raw = Number(process.env.D17_USD_TND_RATE ?? '3.1');
  if (!Number.isFinite(raw) || raw <= 0) return 3.1;
  return raw;
}

/** "45.500" — TND amounts always carry three decimals (millimes). */
export function formatTndMillimes(millimes: number): string {
  return (millimes / 1000).toFixed(3);
}

/** Payment deadline for a checkout starting now. */
export function paymentDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + paymentWindowHours() * 3600 * 1000);
}

/** Submissions from one phone above this count, inside the window, flag for review. */
export function reviewFlagThreshold(): number {
  const raw = Number(process.env.D17_REVIEW_THRESHOLD ?? '3');
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

export function reviewWindowMinutes(): number {
  const raw = Number(process.env.D17_REVIEW_WINDOW_MINUTES ?? '60');
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/** Proof submissions tolerated per hour (per IP and per subscription). */
export function maxProofsPerHour(): number {
  const raw = Number(process.env.D17_MAX_PROOF_PER_HOUR ?? '5');
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

/**
 * Screenshot storage. Outside the web root by construction: the Next
 * standalone bundle serves nothing from here, and the only reader is
 * the staff-only route that streams it after an authorization check.
 */
export function d17UploadsDir(): string {
  return (process.env.D17_UPLOADS_DIR ?? '/app/data/d17-uploads').replace(/\/+$/, '');
}
