/**
 * Device-code authorization POLICY — pure functions, zero infrastructure.
 *
 * RFC 8628-style device flow for Zaino Desktop sign-in. This module decides
 * *what* codes look like and how long they last; lib/auth/device/service.ts
 * decides *how* they are issued, approved, and consumed. No database, no
 * gateway client, no Next.js import — unit-testable anywhere.
 *
 * Security notes:
 *  - device_code has 32 bytes of entropy (256 bits): guessing it is not a
 *    strategy. Only its SHA-256 is ever stored.
 *  - user_code is short and display-friendly (typed into no form here — the
 *    desktop app opens a URL carrying it). Its purpose is to let the person
 *    confirm the code on the portal matches the code the app shows, not to
 *    authorize anything by itself: approval always requires an Auth.js
 *    session bound to an organization.
 *  - A code expires 15 minutes after issue, approved or not. An abandoned
 *    code can therefore never be used later.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Time-to-live of a device code: 15 minutes. */
export const DEVICE_CODE_TTL_SECONDS = 15 * 60;

/** Default polling interval the app must respect (seconds). */
export const DEFAULT_INTERVAL_SECONDS = 5;

/** The app must not poll faster than this, ever. */
export const MIN_INTERVAL_SECONDS = 1;

/** Entropy per device code: 32 bytes → 43 base64url characters. */
export const DEVICE_CODE_BYTES = 32;

/** User-code length and alphabet: no vowels, no lookalikes (0/O, 1/l, 8/B). */
export const USER_CODE_LENGTH = 8;
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ34679';

export type DeviceStatus = 'pending' | 'approved' | 'consumed' | 'expired' | 'revoked';

/**
 * One freshly issued device authorization. `deviceCode` plaintext exists
 * here and in the HTTP response to the app — nowhere else is it written.
 */
export interface DeviceIssuance {
  /** Returned to the app once; used to poll the token endpoint. */
  deviceCode: string;
  /** Stored as SHA-256; presented on the portal approval page. */
  userCode: string;
  deviceCodeHash: string;
  /** Absolute expiry (now + DEVICE_CODE_TTL_SECONDS). */
  expiresAt: Date;
  /** Seconds the app must wait between token polls. */
  intervalSeconds: number;
}

/** sha256 of the raw device code — what the database stores. */
export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode, 'utf8').digest('hex');
}

/** Issue a fresh device authorization. Returns the plaintext device code once. */
export function issueDeviceCode(now: Date = new Date()): DeviceIssuance {
  const deviceCode = randomBytes(DEVICE_CODE_BYTES).toString('base64url');
  let userCode = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    userCode += USER_CODE_ALPHABET.charAt(randomBytes(1).readUInt8(0) % USER_CODE_ALPHABET.length);
  }
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000);
  return {
    deviceCode,
    userCode,
    deviceCodeHash: hashDeviceCode(deviceCode),
    expiresAt,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  };
}

/**
 * Parse a status string from the database row. Unknown statuses are treated
 * as expired so nothing can be authorized with an unrecognized state.
 */
export function parseDeviceStatus(value: string): DeviceStatus {
  switch (value) {
    case 'pending':
    case 'approved':
    case 'consumed':
    case 'expired':
    case 'revoked':
      return value;
    default:
      return 'expired';
  }
}

/** Whether a pending code has passed its expiry. */
export function isCodeExpired(code: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  if (!code.expiresAt) return true;
  return now.getTime() >= code.expiresAt.getTime();
}