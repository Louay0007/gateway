/**
 * Share-link policy that can be checked without a database.
 *
 * The parts that need Postgres (the snapshot boundary, revoke, expiry) are
 * enforced in SQL; what is testable here is the arithmetic and the token
 * handling — a lifetime clamp that disagreed with the row would tell the
 * user a link expires later than it does, and a hash that was not one-way
 * would turn a database dump into working URLs.
 */
import { describe, expect, it } from 'vitest';

import {
  clampShareDays,
  DEFAULT_SHARE_DAYS,
  hashToken,
  MAX_SHARE_DAYS,
} from '@/lib/chat/share';

describe('clampShareDays', () => {
  it('defaults to a week', () => {
    expect(clampShareDays(undefined)).toBe(DEFAULT_SHARE_DAYS);
    expect(DEFAULT_SHARE_DAYS).toBe(7);
  });

  it('refuses a link that outlives the maximum', () => {
    expect(clampShareDays(365)).toBe(MAX_SHARE_DAYS);
    expect(clampShareDays(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SHARE_DAYS);
  });

  it('refuses a link that is already expired', () => {
    expect(clampShareDays(0)).toBe(1);
    expect(clampShareDays(-5)).toBe(1);
  });

  it('keeps a sane request as asked', () => {
    expect(clampShareDays(3)).toBe(3);
    expect(clampShareDays(30)).toBe(30);
  });

  it('truncates a fractional day rather than inserting an interval it cannot parse', () => {
    expect(clampShareDays(2.9)).toBe(2);
  });

  it('never returns a non-integer', () => {
    for (const n of [1, 2.5, 7, 29.99, 30, 31, -1, 0]) {
      expect(Number.isInteger(clampShareDays(n))).toBe(true);
    }
  });
});

describe('hashToken', () => {
  it('is stable, so a lookup by hash finds the row', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('is not reversible and does not contain the token', () => {
    const token = 'a-raw-share-token-value';
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes on a single character, so a guessed token cannot collide', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
