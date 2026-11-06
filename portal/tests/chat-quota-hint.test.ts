/**
 * QuotaHint arithmetic. The component is presentational; the numbers it
 * prints are the part that can be wrong without throwing, so they live in a
 * named function and are checked here.
 */
import { describe, expect, it } from 'vitest';
import { quotaPercent } from '@/lib/chat/quota';
import { formatCompact, formatTokens } from '@/components/chat/quota-hint';

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

describe('dialog number formatting', () => {
  it('keeps both sides of "left of" on one scale', () => {
    // The first cut printed "620,000 left of 1M" — two scales in one
    // sentence, which reads as a typo.
    expect(`${formatCompact(620_000)} left of ${formatCompact(1_000_000)}`).toBe('620k left of 1M');
    expect(formatCompact(40_000)).toBe('40k');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(0)).toBe('0');
  });

  it('abbreviates a chat total only above a million', () => {
    expect(formatTokens(21_420)).toBe('21,420');
    expect(formatTokens(980)).toBe('980');
    expect(formatTokens(1_240_000)).toBe('1.24M');
  });
});
