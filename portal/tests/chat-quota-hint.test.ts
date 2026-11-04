/**
 * QuotaHint arithmetic. The component is presentational; the numbers it
 * prints are the part that can be wrong without throwing, so they live in a
 * named function and are checked here.
 */
import { describe, expect, it } from 'vitest';
import { quotaPercent } from '@/lib/chat/quota';

describe('quotaPercent', () => {
  it('is null when the plan has no token budget', () => {
    expect(quotaPercent(undefined, 10)).toBeNull();
    expect(quotaPercent(0, 10)).toBeNull();
    expect(quotaPercent(-5, 0)).toBeNull();
  });

  it('counts from the remainder, not the usage we are not given', () => {
    // The wall returns what is LEFT. Reading `remaining` as usage would
    // show a fresh account as 100% spent.
    expect(quotaPercent(1000, 1000)).toBe(0);
    expect(quotaPercent(1000, 250)).toBe(75);
    expect(quotaPercent(1000, 0)).toBe(100);
  });

  it('clamps a remainder above the limit rather than going negative', () => {
    // A plan downgrade leaves used > limit for one request.
    expect(quotaPercent(1000, 5000)).toBe(0);
  });

  it('clamps a negative remainder instead of printing more than 100%', () => {
    expect(quotaPercent(1000, -50)).toBe(100);
  });
});
