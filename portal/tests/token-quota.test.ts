/**
 * Token quota wall — the only quota since migration 0023.
 *
 * RULE: allowed = entitled WHERE tokens_used < token_limit.
 * Missing / zero TOKEN entry = UNLIMITED (fail-open for plans created
 * before token budgets existed). Units: RAW TOKENS as the ledger stores
 * them (not millions, not cents).
 */
import { describe, it, expect } from 'vitest';
import {
  BILLABLE_TOKEN_COLUMNS,
  computeTokenAllowedModels,
  remainingTokensByModel,
  isTokenExhausted,
  usageWindowFor,
  outOfTokensMessage,
  mapGatewayModelError,
} from '@/lib/entitlements/quota';
import { resolveTokenLimits } from '@/lib/entitlements/policy';

const STARTER_ENTITLED = ['fast', 'smart'];
const STARTER_TOKENS = { fast: 80_000_000, smart: 32_000_000 };

const PRO_ENTITLED = ['smart', 'frontier'];
const PRO_TOKENS = { smart: 210_000_000, frontier: 85_000_000 };

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

describe('computeTokenAllowedModels — the wall rule', () => {
  it('allows everything under quota', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 1_000_000,
        smart: 500_000,
      }),
    ).toEqual(['fast', 'smart']);
  });

  it('blocks only the token-exhausted alias', () => {
    expect(
      computeTokenAllowedModels(STARTER_ENTITLED, STARTER_TOKENS, {
        fast: 80_000_000,
        smart: 1_000,
      }),
    ).toEqual(['smart']);
  });

  it('denies at-limit (used == limit): the next token would be limit+1', () => {
    expect(
      computeTokenAllowedModels(['smart'], PRO_TOKENS, { smart: 210_000_000 }),
    ).toEqual([]);
  });

  it('returns [] when every alias is token-exhausted (deny-all)', () => {
    expect(
      computeTokenAllowedModels(PRO_ENTITLED, PRO_TOKENS, {
        smart: 300_000_000,
        frontier: 90_000_000,
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
    expect(computeTokenAllowedModels(PRO_ENTITLED, PRO_TOKENS, {})).toEqual(
      PRO_ENTITLED,
    );
  });
});

describe('remainingTokensByModel — clamped at 0, raw tokens', () => {
  it('computes remaining per alias', () => {
    expect(
      remainingTokensByModel(STARTER_TOKENS, { fast: 30_000_000 }),
    ).toEqual({ fast: 50_000_000, smart: 32_000_000 });
  });

  it('shows 0 remaining when over limit (not negative)', () => {
    expect(remainingTokensByModel(STARTER_TOKENS, { fast: 90_000_000 })).toEqual(
      { fast: 0, smart: 32_000_000 },
    );
  });
});

describe('isTokenExhausted', () => {
  it('names token exhaustion exactly at the limit', () => {
    expect(isTokenExhausted('fast', STARTER_TOKENS, { fast: 79_999_999 })).toBe(
      false,
    );
    expect(isTokenExhausted('fast', STARTER_TOKENS, { fast: 80_000_000 })).toBe(
      true,
    );
  });

  it('treats missing/zero limits as never exhausted', () => {
    expect(isTokenExhausted('fast', {}, { fast: 999_999_999 })).toBe(false);
    expect(isTokenExhausted('fast', { fast: 0 }, { fast: 999_999_999 })).toBe(
      false,
    );
  });
});

describe('outOfTokensMessage — the contract string', () => {
  it('names the alias and the reset date', () => {
    expect(outOfTokensMessage('smart', '2026-11-01T00:00:00Z')).toMatch(
      /out of smart tokens/i,
    );
    expect(outOfTokensMessage('smart', '2026-11-01T00:00:00Z')).toMatch(
      /November 1/,
    );
  });

  it('reads sensibly without a reset date', () => {
    expect(outOfTokensMessage('frontier', null)).toMatch(
      /out of frontier tokens/i,
    );
  });
});

describe('resolveTokenLimits — policy', () => {
  it('passes budgets through on a live effect', () => {
    expect(
      resolveTokenLimits({ tokenLimits: { fast: 80_000_000 } }, 'full'),
    ).toEqual({ fast: 80_000_000 });
  });

  it('returns {} on cut (empty allowlist already denies; no budgets leak)', () => {
    expect(
      resolveTokenLimits({ tokenLimits: { fast: 80_000_000 } }, 'cut'),
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

describe('mapGatewayModelError — generic 403 → per-alias token message', () => {
  it('maps a LiteLLM model-denied 403 naming the alias', () => {
    const m = mapGatewayModelError(
      403,
      `{"error":{"message":"Model 'frontier' is not available for this API key"}}`,
    );
    expect(m?.model).toBe('frontier');
    expect(m?.friendly).toMatch(/out of frontier tokens/i);
  });

  it('a token-exhaustion body names tokens, not prompts', () => {
    const m = mapGatewayModelError(
      403,
      `{"error":{"message":"Model 'smart' is not available — out of smart tokens for this period"}}`,
    );
    expect(m?.model).toBe('smart');
    expect(m?.friendly).toMatch(/out of smart tokens/i);
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
    expect(m?.friendly).toMatch(/out of smart tokens/i);
  });

  it('translates an upstream model name in the denial to the alias', () => {
    const m = mapGatewayModelError(
      403,
      '{"error":{"message":"Model \'sonnet-5.5\' is not available for this API key"}}',
    );
    expect(m?.model).toBe('smart');
    expect(m?.friendly).toMatch(/out of smart tokens/i);
    expect(m?.friendly).not.toContain('sonnet');
  });
});
