/**
 * Token quota wall — the only quota since migration 0023, PER BILLING
 * PERIOD since 0038 (it was the Tunis day under 0025/0029).
 *
 * RULE: allowed = entitled WHERE tokens_used < token_limit.
 * Missing / zero TOKEN entry = UNLIMITED (fail-open for plans created
 * before token budgets existed). Units: RAW TOKENS as the ledger stores
 * them (not millions, not cents). Budgets are the plan's MONTHLY total
 * SPLIT across its aliases (0038), never repeated per alias:
 * Starter 25M + 25M = 50M per period, Pro 16,666,667 ×3 ≈ 50M.
 */
import { describe, it, expect } from 'vitest';
import {
  BILLABLE_TOKEN_COLUMNS,
  computeTokenAllowedModels,
  remainingTokensByModel,
  isTokenExhausted,
  tokenPoolFromLimits,
  tokensUsedInWindow,
  usageWindowFor,
  usageWindowForSubscription,
  tunisDayWindow,
  isInTunisDay,
  outOfTokensMessage,
  mapGatewayModelError,
  chargedTokensFor,
  UNKNOWN_TOKENS_KEY,
} from '@/lib/entitlements/quota';
import { resolveTokenLimits } from '@/lib/entitlements/policy';

const STARTER_ENTITLED = ['fast', 'smart'];
const STARTER_TOKENS = { fast: 25_000_000, smart: 25_000_000 };

const PRO_ENTITLED = ['smart', 'frontier', 'fable'];
const PRO_TOKENS = { smart: 16_666_667, frontier: 16_666_667, fable: 16_666_666 };

describe('BILLABLE_TOKEN_COLUMNS — the blended-token definition', () => {
  it('sums all five ledger token columns', () => {
    for (const col of [
      'u.input_tokens',
      'u.output_tokens',
      'u.cache_write_5m_tokens',
      'u.cache_write_1h_tokens',
      'u.cache_read_tokens',
    ]) {
      expect(BILLABLE_TOKEN_COLUMNS).toContain(col);
    }
  });
});

describe('computeTokenAllowedModels — ONE shared pool (0039)', () => {
  it('allows everything under quota', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 1_000_000,
        smart: 500_000,
      }),
    ).toEqual(['fast', 'smart']);
  });

  it('spending the whole allowance on ONE alias does not cut it at that alias slice', () => {
    // THE POINT OF THE POOL. Starter publishes {fast: 25M, smart: 25M} = 50M.
    // A customer who spends all 50M on fast must keep serving on fast: the
    // per-alias split is an allocation, not a cap.
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 45_000_000,
        smart: 0,
      }),
    ).toEqual(['fast', 'smart']);
  });

  it('a partly-spent alias leaves the rest spendable on another model', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 25_000_000,
        smart: 1_000,
      }),
    ).toEqual(['fast', 'smart']);
  });

  it('cuts EVERY alias once the pool is spent — not just the one that spent it', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 50_000_000,
      }),
    ).toEqual([]);
    // Pro's three aliases pool to 50M too, so the same total cuts all three.
    expect(
      computeTokenAllowedModels(PRO_ENTITLED, PRO_TOKENS, {
        smart: 16_666_667,
        frontier: 16_666_667,
        fable: 16_666_666,
      }),
    ).toEqual([]);
  });

  it('denies at-limit (used == pool): the next token would be pool+1', () => {
    expect(
      computeTokenAllowedModels(['smart'], PRO_TOKENS, { smart: 50_000_000 }),
    ).toEqual([]);
  });

  it('counts unmapped spend against the pool (no free inference)', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 20_000_000,
        [UNKNOWN_TOKENS_KEY]: 30_000_000,
      }),
    ).toEqual([]);
  });

  it('treats a missing token entry as UNLIMITED, not deny', () => {
    expect(computeTokenAllowedModels(STARTER_ENTITLED, {}, {})).toEqual(
      STARTER_ENTITLED,
    );
    expect(
      computeTokenAllowedModels(['fast'], { fast: 80_000_000 }, { fast: 1 }),
    ).toEqual(['fast']);
    expect(computeTokenAllowedModels(['other'], { fast: 1 }, {})).toEqual([
      'other',
    ]);
  });

  it('treats 0 / negative token limits as unlimited', () => {
    expect(computeTokenAllowedModels(['a'], { a: 0 }, { a: 999_999 })).toEqual([
      'a',
    ]);
    expect(computeTokenAllowedModels(['a'], { a: -5 }, { a: 999_999 })).toEqual([
      'a',
    ]);
  });
});

describe('tokenPoolFromLimits — the allocation sums to one allowance', () => {
  it('sums the per-alias values into a single pool', () => {
    expect(tokenPoolFromLimits({ fast: 25_000_000, smart: 25_000_000 })).toBe(
      50_000_000,
    );
    expect(
      tokenPoolFromLimits({
        smart: 16_666_667,
        frontier: 16_666_667,
        fable: 16_666_666,
      }),
    ).toBe(50_000_000);
  });

  it('a one-alias plan is the same total', () => {
    expect(tokenPoolFromLimits({ fast: 50_000_000 })).toBe(50_000_000);
  });

  it('ignores zero and negative entries rather than letting them shrink the pool', () => {
    expect(tokenPoolFromLimits({ fast: 50_000_000, smart: 0 })).toBe(50_000_000);
  });

  it('returns null when the plan has no budget at all (unlimited)', () => {
    expect(tokenPoolFromLimits({})).toBeNull();
    expect(tokenPoolFromLimits({ fast: 0 })).toBeNull();
  });
});

describe('tokensUsedInWindow — every alias plus unmapped', () => {
  it('sums all aliases and the unknown bucket', () => {
    expect(
      tokensUsedInWindow({ fast: 1, smart: 2, [UNKNOWN_TOKENS_KEY]: 3 }),
    ).toBe(6);
  });

  it('ignores negative and non-numeric entries', () => {
    expect(
      tokensUsedInWindow({ fast: -5, smart: 10 } as Record<string, number>),
    ).toBe(10);
  });
});

describe('usageWindowFor — grandfathered monthly rows', () => {
  it('uses the subscription period when both ends are known', () => {
    const w = usageWindowFor(
      {
        currentPeriodStart: '2026-10-01T00:00:00Z',
        currentPeriodEnd: '2026-11-01T00:00:00Z',
        dailyQuota: false,
      },
      new Date('2026-10-24T12:00:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('daily rows use the Tunis day even when a period exists', () => {
    const w = usageWindowForSubscription(
      {
        currentPeriodStart: '2026-10-01T00:00:00Z',
        currentPeriodEnd: '2026-11-01T00:00:00Z',
        dailyQuota: true,
      },
      new Date('2026-10-27T12:00:00Z'),
    );
    // Tunis day containing 2026-10-27T12:00Z = 2026-10-26T23:00Z → 2026-10-27T23:00Z
    expect(w.start.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-27T23:00:00.000Z');
  });

  it('falls back to the Tunis day with no subscription row', () => {
    const w = usageWindowFor(null, new Date('2026-10-24T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-23T23:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    // A new day has no usage in it → everything re-allows.
    expect(computeTokenAllowedModels(PRO_ENTITLED, PRO_TOKENS, {})).toEqual(
      PRO_ENTITLED,
    );
  });
});

describe('tunisDayWindow — Africa/Tunis is UTC+1 year-round (no DST)', () => {
  it('a midday UTC instant falls in the Tunis day starting 23:00Z previous day', () => {
    const w = tunisDayWindow(new Date('2026-10-27T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-27T23:00:00.000Z');
  });

  it('just after Tunis midnight starts a new day', () => {
    // 2026-10-27T00:30 Tunis = 2026-10-26T23:30Z → day starting 23:00Z
    const w = tunisDayWindow(new Date('2026-10-26T23:30:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('just before Tunis midnight stays in the old day', () => {
    // 2026-10-26T23:30 Tunis = 2026-10-26T22:30Z → day starting 25th 23:00Z
    const w = tunisDayWindow(new Date('2026-10-26T22:30:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('every day is exactly 24h across month and year boundaries', () => {
    for (const iso of [
      '2026-10-31T12:00:00Z',
      '2026-12-31T12:00:00Z',
      '2027-01-01T00:30:00Z',
      '2027-06-15T08:00:00Z',
    ]) {
      const w = tunisDayWindow(new Date(iso));
      expect(w.end.getTime() - w.start.getTime()).toBe(24 * 60 * 60_000);
    }
    const nye = tunisDayWindow(new Date('2027-01-01T00:30:00Z'));
    expect(nye.start.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(nye.end.toISOString()).toBe('2027-01-01T23:00:00.000Z');
  });

  it('isInTunisDay brackets [start, end)', () => {
    const w = tunisDayWindow(new Date('2026-10-27T12:00:00Z'));
    expect(isInTunisDay(w.start, w.start)).toBe(true);
    expect(isInTunisDay(new Date(w.start.getTime() - 1), w.start)).toBe(false);
    expect(isInTunisDay(w.end, w.start)).toBe(false);
    expect(isInTunisDay(new Date(w.end.getTime() - 1), w.start)).toBe(true);
  });
});

describe('remainingTokensByModel — one pool figure, clamped at 0', () => {
  it('reports what is left of the shared pool', () => {
    // Starter pools to 50M; 7M spent on fast leaves 43M to spend anywhere.
    expect(
      remainingTokensByModel(STARTER_TOKENS, { fast: 7_000_000 }),
    ).toEqual({ pool: 43_000_000 });
  });

  it('spend on a different alias draws from the same pool', () => {
    expect(
      remainingTokensByModel(STARTER_TOKENS, {
        fast: 10_000_000,
        smart: 10_000_000,
      }),
    ).toEqual({ pool: 30_000_000 });
  });

  it('clamps at 0 when over the pool (never negative)', () => {
    expect(
      remainingTokensByModel(STARTER_TOKENS, { fast: 190_000_000 }),
    ).toEqual({ pool: 0 });
  });

  it('returns an empty map for an unlimited plan', () => {
    expect(remainingTokensByModel({}, { fast: 1_000 })).toEqual({});
  });
});

describe('isTokenExhausted — plan-wide, identical for every alias', () => {
  it('is false one token under the pool and true at it', () => {
    expect(
      isTokenExhausted('fast', STARTER_TOKENS, { fast: 49_999_999 }),
    ).toBe(false);
    expect(isTokenExhausted('fast', STARTER_TOKENS, { fast: 50_000_000 })).toBe(
      true,
    );
  });

  it('gives the SAME answer whichever alias is asked about', () => {
    const used = { fast: 50_000_000 };
    expect(isTokenExhausted('fast', STARTER_TOKENS, used)).toBe(true);
    expect(isTokenExhausted('smart', STARTER_TOKENS, used)).toBe(true);
  });

  it('treats missing/zero limits as never exhausted', () => {
    expect(isTokenExhausted('fast', {}, { fast: 999_999_999 })).toBe(false);
    expect(isTokenExhausted('fast', { fast: 0 }, { fast: 999_999_999 })).toBe(
      false,
    );
  });
});

describe('50M pool boundary — 49,999,999 allowed, 50,000,000 cuts everything', () => {
  it('one token under the pool still serves', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 49_999_999,
      }),
    ).toEqual(['fast', 'smart']);
  });

  it('exactly at the pool cuts every alias at once', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 25_000_000,
        smart: 25_000_000,
      }),
    ).toEqual([]);
  });

  it('an exhausted-looking alias does not cut its siblings', () => {
    // Pro spends its entire 50M on smart; frontier and fable never ran, and
    // the pool is gone, so all three are cut — but not before that point.
    expect(
      computeTokenAllowedModels(PRO_ENTITLED, PRO_TOKENS, {
        smart: 49_000_000,
        frontier: 1_000,
      }),
    ).toEqual(['smart', 'frontier', 'fable']);
  });
});

describe('outOfTokensMessage — the contract string', () => {
  // 0038: monthly is the only cadence on a shipped plan, so it is the
  // DEFAULT. A monthly budget described as "resets at midnight" makes the
  // customer wait up for a reset that never comes.
  it('defaults to the period wording, not the daily one', () => {
    expect(outOfTokensMessage('smart')).toMatch(/out of tokens/i);
    expect(outOfTokensMessage('smart')).toMatch(/this period/i);
    expect(outOfTokensMessage('smart')).not.toMatch(/today|midnight/i);
  });

  it('names NO model, because the allowance is one shared pool (0039)', () => {
    // Saying "out of smart tokens" sends the customer to another alias that
    // is equally empty — they conclude the product is broken.
    for (const alias of ['fast', 'smart', 'frontier', 'fable']) {
      expect(outOfTokensMessage(alias)).not.toMatch(/fast|smart|frontier|fable/i);
    }
  });

  it('daily wording is still available when a row is put on a Tunis day', () => {
    expect(outOfTokensMessage('smart', null, 'daily')).toMatch(/today/i);
    expect(outOfTokensMessage('smart', null, 'daily')).toMatch(/midnight.*tunis/i);
  });

  it('legacy period message keeps the renewal wording', () => {
    expect(outOfTokensMessage('smart', '2026-11-01T00:00:00Z', 'period')).toMatch(
      /out of tokens/i,
    );
    expect(outOfTokensMessage('smart', '2026-11-01T00:00:00Z', 'period')).toMatch(
      /November 1/,
    );
  });

  it('reads sensibly without a reset date', () => {
    expect(outOfTokensMessage('frontier', null)).toMatch(/out of tokens/i);
  });
});

describe('resolveTokenLimits — policy', () => {
  it('passes budgets through on a live effect', () => {
    expect(
      resolveTokenLimits({ tokenLimits: { fast: 100_000_000 } }, 'full'),
    ).toEqual({ fast: 100_000_000 });
  });

  it('returns {} on cut (empty allowlist already denies; no budgets leak)', () => {
    expect(
      resolveTokenLimits({ tokenLimits: { fast: 100_000_000 } }, 'cut'),
    ).toEqual({});
  });

  it('drops non-numeric entries', () => {
    expect(
      resolveTokenLimits(
        { tokenLimits: { fast: 10, bogus: 'x' as unknown as number } },
        'full',
      ),
    ).toEqual({ fast: 10 });
  });
});

describe('mapGatewayModelError — generic 403 → plan-wide token message', () => {
  it('maps a LiteLLM model-denied 403 naming the alias', () => {
    const m = mapGatewayModelError(
      403,
      `{"error":{"message":"Model 'frontier' is not available for this API key"}}`,
    );
    // The alias is still extracted for attribution, but the copy is
    // plan-wide: under one pool the model the body names is not the reason.
    expect(m?.model).toBe('frontier');
    expect(m?.friendly).toMatch(/out of tokens/i);
    expect(m?.friendly).not.toMatch(/out of frontier tokens/i);
  });

  it('a token-exhaustion body names tokens, not prompts', () => {
    const m = mapGatewayModelError(
      403,
      `{"error":{"message":"Model 'smart' is not available — out of smart tokens for this period"}}`,
    );
    expect(m?.model).toBe('smart');
    expect(m?.friendly).toMatch(/out of tokens/i);
    // 0038: the mapped copy must not promise a daily reset.
    expect(m?.friendly).toMatch(/this period/i);
    expect(m?.friendly).not.toMatch(/today|midnight/i);
  });

  it('still answers when no alias can be extracted', () => {
    const m = mapGatewayModelError(403, 'LLM Provider NOT provided. Access denied.');
    expect(m?.friendly).toMatch(/not available/i);
  });

  it('passes through non-denial bodies and non-403 statuses', () => {
    expect(
      mapGatewayModelError(403, '{"error":{"message":"overloaded, try again"}}'),
    ).toBeNull();
    expect(mapGatewayModelError(200, "Model 'frontier' is not available")).toBeNull();
  });

  it('never names the model after the JSON error key (2026-10-27 regression)', () => {
    const raw = '{"error":{"message":"The requested model is not available for this API key"}}';
    const m = mapGatewayModelError(403, raw);
    expect(m).not.toBeNull();
    expect(m?.model).toBeNull();
    expect(m?.friendly).not.toContain('error');
  });

  it('uses the model the customer requested when the body names none', () => {
    const raw = '{"error":{"message":"The requested model is not available for this API key"}}';
    const m = mapGatewayModelError(403, raw, 'smart');
    expect(m?.model).toBe('smart');
    expect(m?.friendly).toMatch(/out of tokens/i);
  });

  it('translates an upstream model name in the denial to the alias', () => {
    const m = mapGatewayModelError(
      403,
      '{"error":{"message":"Model \'sonnet-5.5\' is not available for this API key"}}',
    );
    expect(m?.model).toBe('smart');
    expect(m?.friendly).not.toContain('sonnet');
  });
});


/**
 * G20 — unmapped spend is still spend.
 *
 * A row whose `model` resolved to `UNKNOWN_ALIAS` belongs to no alias, so a
 * plain per-alias sum charges it to nothing and it becomes unlimited free
 * inference. The rule: charge the `unknown` bucket to EVERY alias. Over-
 * charging is the correct direction; the collector already reports the
 * unmapped model loudly, so the operator sees the cause.
 */
describe('unmapped tokens are charged to every alias (G20)', () => {
  it('adds the unknown bucket to an alias\'s own spend', () => {
    expect(chargedTokensFor('fast', { fast: 10, [UNKNOWN_TOKENS_KEY]: 5 })).toBe(15);
    // A different alias is charged the strays too — they belong to no one.
    expect(chargedTokensFor('smart', { fast: 10, [UNKNOWN_TOKENS_KEY]: 5 })).toBe(5);
  });

  it('treats missing or negative values as zero, not as a credit', () => {
    expect(chargedTokensFor('fast', {})).toBe(0);
    expect(chargedTokensFor('fast', { fast: -1, [UNKNOWN_TOKENS_KEY]: -9 })).toBe(0);
  });

  it('spends the pool with stray usage, cutting the whole plan', () => {
    const allowed = computeTokenAllowedModels(
      ['fast', 'smart'],
      { fast: 100, smart: 100 },
      { fast: 90, smart: 0, [UNKNOWN_TOKENS_KEY]: 20 },
    );
    // Pool = 200; 90 + 20 = 110 spent, so 90 remain and both aliases serve.
    // The strays are counted exactly once, against the pool the customer
    // actually bought.
    expect(allowed).toEqual(['fast', 'smart']);

    // Push past the pool and the whole plan stops together.
    expect(
      computeTokenAllowedModels(
        ['fast', 'smart'],
        { fast: 100, smart: 100 },
        { fast: 190, smart: 0, [UNKNOWN_TOKENS_KEY]: 20 },
      ),
    ).toEqual([]);
  });

  it('remaining and exhausted agree with the wall about the same number', () => {
    const limits = { fast: 100 };
    const used = { fast: 50, [UNKNOWN_TOKENS_KEY]: 60 };
    expect(remainingTokensByModel(limits, used)).toEqual({ pool: 0 });
    expect(isTokenExhausted('fast', limits, used)).toBe(true);
    expect(computeTokenAllowedModels(['fast'], limits, used)).toEqual([]);
  });

  it('leaves a plan unaffected when nothing is unmapped', () => {
    expect(computeTokenAllowedModels(['fast'], { fast: 100 }, { fast: 99 })).toEqual(['fast']);
  });
});
