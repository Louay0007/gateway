/**
 * Prompt quota wall — under/at/over limit, missing alias=deny, renewal.
 *
 * The rule under test (lib/entitlements/quota.ts):
 *   allowed = entitled WHERE used < limit
 * Counting (migration 0020) is NOT re-tested here — see prompt-count.test.ts.
 * This file tests the COMPARISON every wall (enforce, sync, device pre-check,
 * banners, edge mapping) computes through.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAllowedModels,
  remainingByModel,
  exhaustedModels,
  isExhausted,
  usageWindowFor,
  outOfPromptsMessage,
  mapGatewayModelError,
} from '@/lib/entitlements/quota';

const PRO_ENTITLED = ['smart', 'frontier'];
const PRO_LIMITS = { smart: 1000, frontier: 500 };

describe('computeAllowedModels — the single wall rule', () => {
  it('allows everything under quota', () => {
    expect(
      computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 200, frontier: 100 }),
    ).toEqual(['smart', 'frontier']);
  });

  it('blocks only the exhausted alias (Pro frontier 501+, smart still 200)', () => {
    // The acceptance case: frontier over 500, smart well under.
    expect(
      computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 200, frontier: 501 }),
    ).toEqual(['smart']);
  });

  it('denies at-limit (used == limit): the next request would be limit+1', () => {
    expect(
      computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 1000, frontier: 0 }),
    ).toEqual(['frontier']);
    expect(
      computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 1000, frontier: 500 }),
    ).toEqual([]);
  });

  it('returns [] when every alias is exhausted (deny-all)', () => {
    expect(
      computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 1200, frontier: 999 }),
    ).toEqual([]);
  });

  it('denies a missing alias (no limit entry = 0, never Infinity)', () => {
    // Fast is Starter-only; a Pro row that somehow lists it gets nothing.
    expect(computeAllowedModels(['fast'], PRO_LIMITS, {})).toEqual([]);
    // Plan with no prompt_limits at all denies everything.
    expect(computeAllowedModels(PRO_ENTITLED, {}, {})).toEqual([]);
  });

  it('never grants on zero/negative/non-finite limits', () => {
    expect(computeAllowedModels(['a'], { a: 0 }, {})).toEqual([]);
    expect(computeAllowedModels(['a'], { a: -5 }, {})).toEqual([]);
  });
});

describe('remainingByModel — clamped at 0, never negative', () => {
  it('computes remaining per alias', () => {
    expect(remainingByModel(PRO_LIMITS, { smart: 200, frontier: 100 })).toEqual({
      smart: 800,
      frontier: 400,
    });
  });

  it('shows 0 remaining when over limit (not -1)', () => {
    expect(remainingByModel(PRO_LIMITS, { frontier: 501 })).toEqual({
      smart: 1000,
      frontier: 0,
    });
  });
});

describe('exhaustedModels / isExhausted', () => {
  it('names only the exhausted aliases', () => {
    expect(exhaustedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 200, frontier: 501 })).toEqual([
      'frontier',
    ]);
    expect(exhaustedModels(PRO_ENTITLED, PRO_LIMITS, { smart: 1, frontier: 1 })).toEqual([]);
  });

  it('treats a missing alias as exhausted (deny)', () => {
    expect(isExhausted('fast', PRO_LIMITS, {})).toBe(true);
    expect(isExhausted('frontier', PRO_LIMITS, { frontier: 499 })).toBe(false);
    expect(isExhausted('frontier', PRO_LIMITS, { frontier: 500 })).toBe(true);
  });
});

describe('usageWindowFor — renewal restores', () => {
  it('uses the subscription period when both ends are known', () => {
    const w = usageWindowFor({
      currentPeriodStart: '2026-10-01T00:00:00Z',
      currentPeriodEnd: '2026-11-01T00:00:00Z',
    });
    expect(w.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('falls back to the calendar month, so a new window starts at zero usage', () => {
    const w = usageWindowFor(null, new Date('2026-10-24T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    // A new window has no usage in it → everything re-allows.
    expect(computeAllowedModels(PRO_ENTITLED, PRO_LIMITS, {})).toEqual(PRO_ENTITLED);
  });
});

describe('outOfPromptsMessage — the contract string', () => {
  it('always contains "out of <alias> prompts"', () => {
    expect(outOfPromptsMessage('frontier', '2026-11-01T00:00:00Z')).toMatch(
      /out of frontier prompts/i,
    );
    expect(outOfPromptsMessage('frontier', '2026-11-01T00:00:00Z')).toMatch(/November 1/);
  });

  it('reads sensibly without a reset date', () => {
    expect(outOfPromptsMessage('smart', null)).toMatch(/out of smart prompts/i);
  });
});

describe('mapGatewayModelError — generic 403 → per-alias message', () => {
  it('maps a LiteLLM model-denied 403 naming the alias', () => {
    const m = mapGatewayModelError(
      403,
      `{"error":{"message":"Model 'frontier' is not available for this API key"}}`,
    );
    expect(m?.model).toBe('frontier');
    expect(m?.friendly).toMatch(/out of frontier prompts/i);
  });

  it('still answers when no alias can be extracted', () => {
    const m = mapGatewayModelError(403, 'LLM Provider NOT provided. Access denied.');
    expect(m?.friendly).toMatch(/not available/i);
  });

  it('passes through non-denial bodies and non-403 statuses', () => {
    expect(mapGatewayModelError(403, '{"error":{"message":"overloaded, try again"}}')).toBeNull();
    expect(mapGatewayModelError(200, "Model 'frontier' is not available")).toBeNull();
  });
});
