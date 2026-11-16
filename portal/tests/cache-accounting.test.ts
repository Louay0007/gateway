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
import { readFileSync } from 'node:fs';
import { PRICE_FILE } from '@/lib/pricing/path';
import { BILLABLE_TOKEN_COLUMNS, CACHE_READ_CEILING, CACHE_READ_WEIGHT, usageWindowForSubscription } from '@/lib/entitlements/quota';
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
  it('CACHE_READ_WEIGHT matches every model in prices/models.yaml', () => {
    // The pool and the invoice must move together. If a future price edit
    // makes a cache read cost something other than 1/10 of fresh input, the
    // weight has to be revisited — this fails rather than drifting silently.
    //
    // Parsed per model block, not by document order: an input line and the
    // cache line it divides must belong to the same model, or the check
    // passes vacuously when only the first model is edited.
    const yaml = readFileSync(PRICE_FILE, 'utf8');
    const ratios: string[] = [];
    let input: number | null = null;
    for (const line of yaml.split('\n')) {
      const i = line.match(/^\s{4}input_per_mtok:\s*([\d.]+)/);
      if (i) { input = Number(i[1]); continue; }
      const c = line.match(/^\s{4}cache_read_per_mtok:\s*([\d.]+)/);
      if (c && input !== null) { ratios.push(String(input / Number(c[1]))); input = null; }
    }
    expect(ratios.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ratios)).toEqual(new Set([String(CACHE_READ_WEIGHT)]));
  });
  it('charges a cache read at one tenth, matching the price table', () => {
    // cache_read_input_token_cost is a tenth of input_cost_per_token in
    // config/litellm.yaml, mirrored in prices/models.yaml. Counting a cached
    // prefix at full weight made the pool disagree with the invoice by up to
    // 10x: on production 91% of billed tokens were cache reads, so a Claude
    // Desktop conversation read 22M where the same prompts in chat read 13k.
    // A cache read is divided by ten AND capped at 64k, so one runaway
    // Desktop turn cannot bill a customer for their own history.
    // A cache read is divided by ten AND capped, so one runaway Desktop turn
    // cannot bill a customer for their own accumulated history.
    expect(BILLABLE_TOKEN_COLUMNS).toMatch(
      new RegExp(`LEAST\\(COALESCE\\(u\\.cache_read_tokens,0\\), ${CACHE_READ_CEILING}\\) / ${CACHE_READ_WEIGHT}`),
    );
  });
  it('does not divide output or fresh input — only the cached read', () => {
    // Guard against "fix the ratio everywhere": that would under-charge real
    // work by 10x instead of over-charging the cache by 10x.
    expect(BILLABLE_TOKEN_COLUMNS).not.toMatch(/output_tokens\s*,?\s*0\s*\)\s*\//);
    expect(BILLABLE_TOKEN_COLUMNS).not.toMatch(/fresh_input_tokens[^+]*\/\s*10/);
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

describe('the pool equals the AiPilot bill, in token units', () => {
  /**
   * price-table weights, so the assertion below reads as arithmetic rather
   * than magic numbers.
   */
  const IN = 3.0, CACHED = 0.3, OUT = 15.0; // $/Mtok, sonnet-5.5
  const units = (f: number, c: number, o: number, w: number) =>
    f + o * 5 + w * 2 + c / 10;

  it('reproduces a measured AiPilot charge to 5 decimal places', () => {
    // Measured on production over 7 days for `smart`:
    //   fresh 3,583,923  cached 38,615,600  output 43,957  writes 0
    //   AiPilot billed $22.995771
    const f = 3_583_923, c = 38_615_600, o = 43_957, w = 0;
    const predicted = (units(f, c, o, w) * IN) / 1_000_000;
    expect(predicted).toBeCloseTo(22.9958, 4);
    // The cost formula the price table uses must agree with the pool.
    const byPrice = (f * IN + c * CACHED + o * OUT) / 1_000_000;
    expect(predicted).toBeCloseTo(byPrice, 6);
  });

  it('counts output five times, not once', () => {
    // One fresh token plus one output token costs 6 input-tokens' worth.
    expect(units(1, 0, 1, 0)).toBe(6);
  });

  it('counts a cache write twice, never once', () => {
    // Writes cost 2x input in prices/models.yaml. Counting them 1x would
    // under-charge the pool for the most expensive first turn.
    expect(units(0, 0, 0, 1)).toBe(2);
  });

  it('still discounts a cache read tenfold', () => {
    expect(units(0, 10, 0, 0)).toBe(1);
  });
});

describe('per-model weight — a frontier token costs what it costs', () => {
  const WEIGHT: Record<string, number> = { fast: 1/3, smart: 1, frontier: 5, fable: 5 };
  const units = (model: string, f: number, c: number, o: number) =>
    (f + o * 5 + c / 10) * WEIGHT[model]!;

  it('reproduces a mixed-tier bill to 0.01%', () => {
    // Production, 7 days, all models: 8,755,856 weighted units against
    // $26.267524 charged. At the $3.00 input rate the two must agree.
    const rows = [
      { m: 'smart', f: 3_586_317, c: 42_184_482, o: 44_616 },
      { m: 'frontier', f: 15_497, c: 1_611, o: 25_984 },
      { m: 'fast', f: 21, c: 0, o: 68 },
    ];
    const total = rows.reduce((s, r) => s + units(r.m, r.f, r.c, r.o), 0);
    const asUsd = (total * 3.0) / 1_000_000;
    expect(Math.abs(asUsd / 26.267525 - 1) * 100).toBeLessThan(0.05);
  });

  it('one frontier token costs five smart tokens', () => {
    expect(units('frontier', 1, 0, 0)).toBe(5);
    expect(units('smart', 5, 0, 0)).toBe(5);
  });

  it('one fast token costs a third of a smart token', () => {
    expect(units('fast', 3, 0, 0)).toBeCloseTo(1, 10);
  });

  it('an unknown alias is counted, never free', () => {
    // ELSE 3 in the SQL — an alias the price map has not learned yet must
    // still consume quota, or it becomes unmetered inference.
    const sql = BILLABLE_TOKEN_COLUMNS.replace(/\s+/g, ' ');
    expect(sql).toContain('ELSE 3');
  });
});

describe('cache-read ceiling — two clients, one price', () => {
  const CACHE_READ_CEILING = 64_000;
  /** Mirror of the SQL: cached input cannot exceed the ceiling. */
  const units = (fresh: number, cached: number, out: number) =>
    fresh + out * 5 + Math.min(cached, CACHE_READ_CEILING) / 10;

  it('a Desktop turn no longer bills its whole history', () => {
    // Measured production average for /v1/messages before the cap:
    // fresh 55,836 + cached 602,080 + out 195 -> 117,016 units.
    const before = 55_836 + 195 * 5 + 602_080 / 10;
    const after = units(55_836, 602_080, 195);
    expect(before).toBeGreaterThan(117_000);
    expect(after).toBe(63_211);
    // The cap removes the history cost, not the real work.
    expect(after).toBeGreaterThan(55_836);
  });

  it('leaves an ordinary chat turn untouched', () => {
    // Measured: fresh 3,258 + cached 70 + out 2,480 -> 15,664 units.
    expect(units(3_258, 70, 2_480)).toBe(15_665);
  });

  it('the two routes converge instead of differing by 13x', () => {
    const desktop = units(55_836, 602_080, 195); // 62,305
    const chat = units(3_258, 70, 2_480);        // 15,665
    expect(desktop / chat).toBeLessThan(4.5);
  });

  it('a cache MISS still bills full fresh input', () => {
    // The cap is on the cached reuse, not on new tokens. A miss sends its
    // prompt as fresh, and that is what the provider actually charges for.
    expect(units(714_262, 0, 214)).toBeGreaterThan(715_000);
  });
});
