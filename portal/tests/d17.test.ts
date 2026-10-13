/**
 * D17 payment unit tests — the rules that protect the money path.
 *
 * All of it is pure (lib/billing/d17-config.ts): the amount, the
 * authorization-number shape, the phone shape, the deadline. A fake
 * database proves nothing here — these are the values a customer types
 * and the arithmetic a transfer is checked against.
 *
 * The lifecycle itself (submit → duplicate → approve → reject →
 * expire → double-approve) is verified live against the stack, the same
 * way the money path is, because the unique index and the audit table
 * are the things under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  amountTndMillimes,
  authNumberPattern,
  detectScreenshotType,
  formatTndMillimes,
  isValidAuthNumber,
  normalizeAuthNumber,
  normalizeSenderPhone,
  paymentDeadline,
  paymentWindowHours,
} from '@/lib/billing/d17-config';

const ENV_KEYS = [
  'PAYMENT_WINDOW_HOURS',
  'AUTH_NUMBER_REGEX',
  'D17_USD_TND_RATE',
  'D17_RECEIVER_PHONE',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('authorization numbers', () => {
  it('normalizes to trimmed uppercase — the stored and unique form', () => {
    expect(normalizeAuthNumber('  ab12cd ')).toBe('AB12CD');
  });

  it('accepts the default 4-32 alphanumeric shape', () => {
    expect(authNumberPattern().source).toBe('^[A-Za-z0-9]{4,32}$');
    expect(isValidAuthNumber(normalizeAuthNumber('a1b2'))).toBe(true);
    expect(isValidAuthNumber(normalizeAuthNumber('X'.repeat(32)))).toBe(true);
  });

  it('rejects empty, short, and over-long numbers regardless of config', () => {
    expect(isValidAuthNumber(normalizeAuthNumber(''))).toBe(false);
    expect(isValidAuthNumber(normalizeAuthNumber('a1b'))).toBe(false);
    expect(isValidAuthNumber(normalizeAuthNumber('X'.repeat(33)))).toBe(false);
  });

  it('bounds the length even when the configured pattern is permissive', () => {
    // The character set is the operator's choice (they set the regex);
    // the LENGTH has an absolute ceiling — a regex that matches
    // everything must not silently widen the column's data shape.
    process.env.AUTH_NUMBER_REGEX = '^.+$';
    expect(isValidAuthNumber('a1b2')).toBe(true);
    expect(isValidAuthNumber('has spaces')).toBe(true);
    expect(isValidAuthNumber('X'.repeat(64))).toBe(true);
    expect(isValidAuthNumber('X'.repeat(65))).toBe(false);
  });

  it('uses the configured pattern when one is set', () => {
    process.env.AUTH_NUMBER_REGEX = '^D17-[0-9]{6}$';
    expect(isValidAuthNumber('D17-123456')).toBe(true);
    expect(isValidAuthNumber('ABC-123456')).toBe(false);
  });

  it('falls back to the safe default for a broken regex', () => {
    process.env.AUTH_NUMBER_REGEX = '([unclosed';
    expect(authNumberPattern().source).toBe('^[A-Za-z0-9]{4,32}$');
  });
});

describe('sender phone (Tunisian mobile)', () => {
  it('accepts 8 digits with or without the +216 prefix and spacing', () => {
    expect(normalizeSenderPhone('12345678')).toBe('12345678');
    expect(normalizeSenderPhone('+21612345678')).toBe('12345678');
    expect(normalizeSenderPhone('0021612345678')).toBe('12345678');
    expect(normalizeSenderPhone('12 345 678')).toBe('12345678');
    expect(normalizeSenderPhone('12-345-678')).toBe('12345678');
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(normalizeSenderPhone('1234567')).toBeNull();
    expect(normalizeSenderPhone('123456789')).toBeNull();
    expect(normalizeSenderPhone('12a45678')).toBeNull();
    expect(normalizeSenderPhone('')).toBeNull();
  });
});

describe('amount (USD cents -> TND millimes)', () => {
  it('converts at the configured rate with three-decimal precision', () => {
    // $19 at 3.10 = 58.900 DT
    expect(amountTndMillimes(1900, 3.1)).toBe(58_900);
    // $99 at 3.10 = 306.900 DT
    expect(amountTndMillimes(9900, 3.1)).toBe(306_900);
  });

  it('formats with exactly three decimals (millimes)', () => {
    expect(formatTndMillimes(45_500)).toBe('45.500');
    expect(formatTndMillimes(58_900)).toBe('58.900');
    expect(formatTndMillimes(1)).toBe('0.001');
  });

  it('reads the rate from the environment', () => {
    process.env.D17_USD_TND_RATE = '3.5';
    // $10 at 3.5 = 35.000 DT
    expect(amountTndMillimes(1000)).toBe(35_000);
  });
});

describe('payment window', () => {
  it('defaults to 24 hours', () => {
    expect(paymentWindowHours()).toBe(24);
    const deadline = paymentDeadline(new Date('2026-01-01T00:00:00Z'));
    expect(deadline.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('is configurable', () => {
    process.env.PAYMENT_WINDOW_HOURS = '6';
    expect(paymentWindowHours()).toBe(6);
    const deadline = paymentDeadline(new Date('2026-01-01T00:00:00Z'));
    expect(deadline.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });

  it('ignores nonsense values rather than disabling the window', () => {
    process.env.PAYMENT_WINDOW_HOURS = '-5';
    expect(paymentWindowHours()).toBe(24);
    process.env.PAYMENT_WINDOW_HOURS = 'not-a-number';
    expect(paymentWindowHours()).toBe(24);
  });
});

describe('screenshot type detection (by CONTENT, not by MIME claim)', () => {
  it('recognizes a JPEG', () => {
    const found = detectScreenshotType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    expect(found?.mime).toBe('image/jpeg');
    expect(found?.ext).toBe('jpg');
  });

  it('recognizes a PNG', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('rest'),
    ]);
    expect(detectScreenshotType(png)?.mime).toBe('image/png');
  });

  it('recognizes a WebP', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
    ]);
    expect(detectScreenshotType(webp)?.mime).toBe('image/webp');
  });

  it('refuses anything else, including a renamed executable', () => {
    expect(detectScreenshotType(Buffer.from('MZ\u0090\u0000'))).toBeNull();
    expect(detectScreenshotType(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(detectScreenshotType(Buffer.alloc(0))).toBeNull();
  });
});
