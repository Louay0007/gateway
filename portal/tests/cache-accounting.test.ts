/**
 * Cached-token accounting — the 0028 regression suite.
 *
 * THE BUG THIS LOCKS DOWN. `usage_records.input_tokens` is the provider's
 * `prompt_tokens`, which INCLUDES `cached_tokens` (OpenAI semantics, and
 * verified inclusive on LiteLLM's Anthropic `/v1/messages` path too). Every
 * blended-token sum used to add `input_tokens + cache_read_tokens`, so the
 * cached portion was billed to the quota twice.
 *
 * Measured on production before the fix:
 *
 *   prompt 297807 | cached 297289 | fresh 518
 *   old blended  595926   ← 2×, customers cut early
 *   correct      298637   = total_tokens
 *
 * THE IDENTITY under test, for every dialect:
 *
 *   fresh_input + cache_writes + cache_read + output
 *     == prompt_tokens + completion_tokens
 *     == total_tokens
 *
 * The numbers below are REAL responses captured from the live upstream and
 * the live LiteLLM spend log, not invented fixtures. A test that only ever
 * sees zero-cache traffic cannot catch this class of bug — which is exactly
 * how it shipped.
 */
import { describe, it, expect } from 'vitest';
import { BILLABLE_TOKEN_COLUMNS, usageWindowForSubscription } from '@/lib/entitlements/quota';
import { billableTokens, priceUsage, type TokenCounts, type ModelPrice } from '@/lib/pricing';
import { extractUsage, type SpendLogRow } from '@/lib/litellm/client';

/** One real captured call: cached turn, via /v1/chat/completions. */
const CACHED_TURN = {
  prompt: 3969,
  cached: 3914,
  completion: 16,
  total: 3985,
};

/** One real captured call: no cache. */
const COLD_TURN = {
  prompt: 3969,
  cached: 0,
  completion: 16,
  total: 3985,
};

/** The production outlier that exposed the bug (297k-token agentic turn). */
const HUGE_CACHED_TURN = {
  prompt: 297807,
  cached: 297289,
  completion: 830,
  total: 298637,
};

/** A spend-log row in LiteLLM v1.103.1's shape. */
function spendRow(prompt: number, completion: number, cached: number, total: number): SpendLogRow {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    metadata: {
      usage_object: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        prompt_tokens_details: { cached_tokens: cached },
      },
    },
  } as unknown as SpendLogRow;
}

const SONNET: ModelPrice = {
  input_per_mtok: 3.0,
  output_per_mtok: 15.0,
  cache_write_5m_per_mtok: 6.0,
  cache_write_1h_per_mtok: 6.0,
  cache_read_per_mtok: 0.3,
};

describe('extractUsage — fresh input excludes cache reads', () => {
  it('splits a cached turn into fresh + cached without losing a token', () => {
    const u = extractUsage(spendRow(CACHED_TURN.prompt, CACHED_TURN.completion, CACHED_TURN.cached, CACHED_TURN.total));

    expect(u.inputTokens).toBe(3969);      // raw, inclusive — kept for audit
    expect(u.freshInput).toBe(55);         // 3969 - 3914
    expect(u.cacheRead).toBe(3914);
    expect(u.outputTokens).toBe(16);

    // THE IDENTITY: fresh + cache + output == total_tokens.
    expect(u.freshInput + u.cacheRead + u.outputTokens).toBe(CACHED_TURN.total);
  });

  it('keeps a cold turn unchanged (no cache means fresh == prompt)', () => {
    const u = extractUsage(spendRow(COLD_TURN.prompt, COLD_TURN.completion, COLD_TURN.cached, COLD_TURN.total));

    expect(u.freshInput).toBe(3969);
    expect(u.cacheRead).toBe(0);
    expect(u.freshInput + u.cacheRead + u.outputTokens).toBe(COLD_TURN.total);
  });

  it('holds on the 297k production row that exposed the double-count', () => {
    const u = extractUsage(
      spendRow(HUGE_CACHED_TURN.prompt, HUGE_CACHED_TURN.completion, HUGE_CACHED_TURN.cached, HUGE_CACHED_TURN.total),
    );

    expect(u.freshInput).toBe(518);
    expect(u.cacheRead).toBe(297289);
    expect(u.freshInput + u.cacheRead + u.outputTokens).toBe(298637);

    // The old sum, which is what the quota wall charged:
    expect(u.inputTokens + u.cacheRead + u.outputTokens).toBe(595926);
  });

  it('never goes negative when a provider reports input exclusive of cache', () => {
    // No live row has this shape, but a provider swap could introduce it.
    // cacheRead > input would produce a negative without the floor.
    const u = extractUsage(spendRow(54, 3, 3914, 3971));
    expect(u.freshInput).toBe(0);
    expect(u.freshInput).toBeGreaterThanOrEqual(0);
  });

  it('is inclusive on the Anthropic /v1/messages path too', () => {
    // Real capture: prompt 3968, cached 3914, total 3971 (= 3968 + 3).
    // The spend log stores prompt_tokens inclusively even here, so one
    // normalisation rule covers both wire formats.
    const u = extractUsage(spendRow(3968, 3, 3914, 3971));
    expect(u.freshInput).toBe(54);
    expect(u.freshInput + u.cacheRead + u.outputTokens).toBe(3971);
  });
});

describe('billableTokens — the meter matches the provider', () => {
  it('counts a cached turn once, not twice', () => {
    const counts: TokenCounts = {
      inputTokens: 55,
      outputTokens: 16,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 3914,
    };
    expect(billableTokens(counts)).toBe(CACHED_TURN.total);
  });

  it('reproduces the pre-fix inflation when fed inclusive input', () => {
    // This is the guard against a future caller passing `prompt_tokens`
    // straight in: the result is visibly wrong (2x), so the assertion in
    // the next test fails loudly rather than shipping.
    const wrong: TokenCounts = {
      inputTokens: 3969,     // inclusive — WRONG for this API
      outputTokens: 16,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 3914,
    };
    expect(billableTokens(wrong)).toBe(7899);
    expect(billableTokens(wrong)).not.toBe(CACHED_TURN.total);
  });
});

describe('priceUsage — money agrees with row.spend', () => {
  it('prices a cached turn at the cache-read rate for the cached portion', () => {
    // Expected, computed by hand: 55 fresh @ $3/M + 3914 cached @ $0.30/M
    // + 16 out @ $15/M.
    const expected =
      (55 / 1e6) * 3.0 + (3914 / 1e6) * 0.3 + (16 / 1e6) * 15.0;

    const got = priceUsage(
      { inputTokens: 55, outputTokens: 16, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 3914 },
      SONNET,
    ).total;

    expect(got).toBeCloseTo(expected, 10);
  });

  it('reproduces the production row exactly — $0.10319070', () => {
    // The ledger holds 0.10319070 for this call, sourced from LiteLLM's
    // row.spend. Feeding FRESH input must reproduce it; feeding inclusive
    // input gives $0.99505770 (864% over), which is why the two must never
    // be confused.
    const fresh = priceUsage(
      { inputTokens: 518, outputTokens: 830, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 297289 },
      SONNET,
    ).total;
    expect(fresh).toBeCloseTo(0.1031907, 8);

    const inclusive = priceUsage(
      { inputTokens: 297807, outputTokens: 830, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 297289 },
      SONNET,
    ).total;
    expect(inclusive).toBeCloseTo(0.9950577, 7);
    expect(inclusive).toBeGreaterThan(fresh * 8);
  });
});

describe('BILLABLE_TOKEN_COLUMNS — the wall sums the normalised column', () => {
  it('reads fresh_input_tokens, not the raw inclusive input_tokens', () => {
    expect(BILLABLE_TOKEN_COLUMNS).toContain('fresh_input_tokens');
    // The raw column may appear ONLY inside the COALESCE fallback, never as
    // a primary term — a bare `COALESCE(u.input_tokens,0)` is the bug.
    expect(BILLABLE_TOKEN_COLUMNS).not.toMatch(/COALESCE\(\s*u\.input_tokens\s*,\s*0\s*\)/);
  });

  it('still counts cache writes and cache reads as separate buckets', () => {
    expect(BILLABLE_TOKEN_COLUMNS).toContain('cache_write_5m_tokens');
    expect(BILLABLE_TOKEN_COLUMNS).toContain('cache_write_1h_tokens');
    expect(BILLABLE_TOKEN_COLUMNS).toContain('cache_read_tokens');
  });
});

describe('quota window — the period is live since 0038, the day is the escape hatch', () => {
  it('every live subscription resolves the PERIOD (dailyQuota false)', () => {
    // 0038 flipped every row to FALSE and made it the column default, so
    // the period is the shipped behaviour: a plan's budgets are its
    // monthly total, split across aliases, and summing them over a day
    // would grant 30x the allowance.
    const sub = {
      currentPeriodStart: '2026-10-25T00:00:00Z',
      currentPeriodEnd: '2026-11-25T00:00:00Z',
      dailyQuota: false,
    };
    const w = usageWindowForSubscription(sub, new Date('2026-11-02T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-25T00:00:00.000Z');
  });

  it('an explicit dailyQuota row still resolves the Tunis day', () => {
    // The one-row escape hatch. Nothing writes TRUE any more (0038 sets the
    // default to FALSE and every writer passes false), but the code path
    // stays: a restored pre-0038 dump must still behave, and an operator
    // who deliberately wants a per-day cap has to have a way to ask.
    const sub = {
      currentPeriodStart: '2026-10-25T00:00:00Z',
      currentPeriodEnd: '2026-11-25T00:00:00Z',
      dailyQuota: true,
    };

    const w = usageWindowForSubscription(sub, new Date('2026-11-02T12:00:00Z'));
    expect(w.end.getTime() - w.start.getTime()).toBe(86_400_000);
  });
});
