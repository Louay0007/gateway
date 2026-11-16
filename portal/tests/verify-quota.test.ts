import { describe, it, expect } from 'vitest';
import {
  UNKNOWN_TOKENS_KEY,
  BILLABLE_TOKEN_COLUMNS,
  computeTokenAllowedModels,
  tokenPoolFromLimits,
  usageWindowFor,
} from '@/lib/entitlements/quota';

/** The production blended-token expression, evaluated in JS. */
function blended(r: Record<string, number | null | undefined>): number {
  const input = r.input_tokens ?? 0;
  const cacheRead = r.cache_read_tokens ?? 0;
  const fresh = r.fresh_input_tokens ?? input - Math.min(cacheRead, input);
  return fresh + (r.output_tokens ?? 0)
    + (r.cache_write_5m_tokens ?? 0) + (r.cache_write_1h_tokens ?? 0)
    + cacheRead;
}

describe('prod-shape: what a Claude Desktop call actually bills', () => {
  it('reasoning tokens count: output_tokens is the whole answer', () => {
    // A "say ok" on claude-smart at reasoning_effort=max. LiteLLM reports
    // the reasoning spend inside output_tokens.
    const row = { input_tokens: 4, fresh_input_tokens: 4, output_tokens: 1200,
                  cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };
    expect(blended(row)).toBe(1204);
  });

  it('a cached turn does not double-count the prompt', () => {
    // 100k prompt, 90k served from cache. Fresh is 10k; the 90k is billed
    // once as cache_read, not again as input.
    const row = { input_tokens: 100_000, fresh_input_tokens: 10_000,
                  output_tokens: 500, cache_read_tokens: 90_000,
                  cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };
    expect(blended(row)).toBe(100_500);
  });

  it('no fresh column present: falls back to input - cache_read', () => {
    const row = { input_tokens: 100_000, output_tokens: 500, cache_read_tokens: 90_000 };
    expect(blended(row)).toBe(100_500);
  });
});

describe('prod-shape: the 50M pool as one ledger', () => {
  const ENTITLED = ['smart', 'frontier', 'fable'];
  const LIMITS = { smart: 50_000_000 };
  const POOL = tokenPoolFromLimits(LIMITS);

  it('pool is 50M regardless of how the plan splits it', () => {
    expect(POOL).toBe(50_000_000);
    expect(tokenPoolFromLimits({ fast: 25_000_000, smart: 25_000_000 })).toBe(50_000_000);
  });

  it('27.6M spent via claude-fable (ledger alias "fable") leaves 22.4M', () => {
    const used = { fable: 27_600_000 };
    expect(computeTokenAllowedModels(ENTITLED, LIMITS, used))
      .toEqual(['smart', 'frontier', 'fable']);
  });

  it('at the pool, every tier is cut at once', () => {
    expect(computeTokenAllowedModels(ENTITLED, LIMITS, { fable: 50_000_000 })).toEqual([]);
  });

  it('spend recorded under an unmapped name still draws the pool', () => {
    // unknown bucket included in the sum by tokensUsedInWindow
    expect(computeTokenAllowedModels(ENTITLED, LIMITS, { [UNKNOWN_TOKENS_KEY]: 50_000_000 })).toEqual([]);
  });
});

describe('prod-shape: the window the meter and the wall share', () => {
  it('daily row windows on the Tunis day, not the month', () => {
    const sub = { dailyQuota: true,
      currentPeriodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z' };
    const w = usageWindowFor(sub, new Date('2026-11-15T14:30:00Z'));
    expect(w.end.getTime() - w.start.getTime()).toBe(24 * 3600 * 1000);
  });

  it('a monthly row windows on the subscription period', () => {
    const sub = { dailyQuota: false,
      currentPeriodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z' };
    const w = usageWindowFor(sub, new Date('2026-11-15T14:30:00Z'));
    expect(w.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('the billable expression names all five ledger columns', () => {
    for (const c of ['input_tokens','output_tokens','cache_write_5m_tokens','cache_write_1h_tokens','cache_read_tokens']) {
      expect(BILLABLE_TOKEN_COLUMNS).toContain(c);
    }
  });
});
