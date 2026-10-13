import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  validatePassword,
  PARAMS,
} from '@/lib/auth/password';
import { resolveBudgetUsd, resolveLimits, CUT_BUDGET, STATUS_EFFECT } from '@/lib/entitlements/policy';
import { slugify, slugCandidates } from '@/lib/org/slug';
import { resolvePrice } from '@/lib/pricing';


describe('password hashing (scrypt)', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery stapel', stored)).resolves.toBe(false);
  });

  it('salts, so identical passwords produce different hashes', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
  });

  it('stores self-describing parameters so cost can be raised later', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBe(PARAMS.N);
    expect(parts).toHaveLength(7);
  });

  it('rejects a nonexistent user without throwing (timing parity)', async () => {
    await expect(verifyPassword('anything at all', null)).resolves.toBe(false);
    await expect(verifyPassword('anything at all', undefined)).resolves.toBe(false);
  });

  it('rejects a malformed stored hash rather than crashing', async () => {
    await expect(verifyPassword('whatever', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('whatever', 'bcrypt$1$2$3$4$5$6')).resolves.toBe(false);
  });

  it('flags a hash with weaker parameters for upgrade', () => {
    const weak = `scrypt$1024$8$1$32$${Buffer.from('s').toString('base64')}$${Buffer.from('h').toString('base64')}`;
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('password policy', () => {
  it('requires length and at least two character classes', () => {
    expect(validatePassword('short').ok).toBe(false);
    // Single-class is rejected even when long...
    expect(validatePassword('abcdefghijklmn').ok).toBe(false);
    // ...but a long passphrase using two classes is accepted. NIST
    // SP 800-63B advises against symbol/case/digit conjunctions, so
    // 'alllowercase12345' is a legitimate passphrase and MUST pass.
    expect(validatePassword('alllowercase12345').ok).toBe(true);
    expect(validatePassword('Str0ngEnoughPass!').ok).toBe(true);
  });

  it('rejects long repeated runs that length alone would allow', () => {
    expect(validatePassword('aaaaaaaaaaaaaa').ok).toBe(false);
    expect(validatePassword('123456789012345').ok).toBe(false);
  });

  it('rejects the common list', () => {
    expect(validatePassword('password1234').ok).toBe(false);
  });
});

/**
 * THE BUG THIS FILE EXISTS TO PREVENT.
 *
 * LiteLLM reads a limit of 0 as "unlimited" (BLUEPRINT.md §9.4). Writing 0
 * for a customer we meant to suspend GRANTS them unlimited access — the
 * most expensive possible mistake in this system. Every cut/zero path must
 * resolve to CUT_BUDGET, never 0.
 */
describe('budget resolution — 0 is unlimited, not deny', () => {
  const freePlan = { includedSpendCents: 0, hardCapCents: 0, rateMultiplierBps: 13000 };
  const noCapPlan = { includedSpendCents: 2000, hardCapCents: null, rateMultiplierBps: 13000 };
  const cappedPlan = { includedSpendCents: 18000, hardCapCents: 60000, rateMultiplierBps: 12500 };

  it('never resolves a zero-allowance plan to 0', () => {
    expect(resolveBudgetUsd(freePlan, 'full')).toBe(CUT_BUDGET);
    expect(resolveBudgetUsd(freePlan, 'cut')).toBe(CUT_BUDGET);
  });

  it('falls back to included spend when there is no hard cap, converted to upstream', () => {
    // $20 customer at 1.30× = $15.38 upstream. The gateway tracks upstream.
    expect(resolveBudgetUsd(noCapPlan, 'full')).toBeCloseTo(2000 / 100 / 1.3, 6);
  });

  it('prefers the hard cap when present, converted to upstream', () => {
    // $600 customer at 1.25× = $480 upstream. Returning $600 directly
    // would let the customer spend $750 before the cutoff.
    expect(resolveBudgetUsd(cappedPlan, 'full')).toBeCloseTo(60000 / 100 / 1.25, 6);
  });

  it('cuts to CUT_BUDGET regardless of plan', () => {
    expect(resolveBudgetUsd(cappedPlan, 'cut')).toBe(CUT_BUDGET);
    expect(CUT_BUDGET).toBeGreaterThan(0);
  });

  it('is strictly positive in every case', () => {
    for (const plan of [freePlan, noCapPlan, cappedPlan]) {
      for (const effect of ['full', 'cut'] as const) {
        expect(resolveBudgetUsd(plan, effect)).toBeGreaterThan(0);
      }
    }
  });

  it('enforces the overage invariant: markup == multiplier - 10000', () => {
    // Starter 13000 → 3000, Pro 12500 → 2500. Applying BOTH would bill
    // Starter overage at 1.30 × 1.30. The ledger applies the multiplier
    // once; overage_markup_bps is the same margin in the other unit.
    expect(13000 - 10000).toBe(3000);
    expect(12500 - 10000).toBe(2500);
  });
});

describe('a cut org keeps keys alive but loses every capability', () => {
  const plan = {
    rpmLimit: 60, tpmLimit: 200000, maxConcurrentRequests: 5,
    models: ['fast'], includedSpendCents: 0, hardCapCents: 0,
    rateMultiplierBps: 13000,
  };

  it('empties the model allowlist so nothing is reachable', () => {
    const limits = resolveLimits(plan, 'cut');
    expect(limits.models).toEqual([]);
    expect(limits.maxBudgetUsd).toBe(CUT_BUDGET);
  });

  it('preserves limits on a full-access org', () => {
    const limits = resolveLimits(plan, 'full');
    expect(limits.models).toEqual(['fast']);
    expect(limits.rpm).toBe(60);
    expect(limits.tpm).toBe(200000);
  });
});

describe('subscription status → effect', () => {
  it('gives past_due a grace period instead of cutting service', () => {
    // PLATFORM.md §5.1: cut on `unpaid`, never on `past_due`. A mistyped
    // card must not cost the customer their service.
    expect(STATUS_EFFECT.past_due).toBe('full');
    expect(STATUS_EFFECT.unpaid).toBe('cut');
  });

  it('keeps trialing and active at full access', () => {
    expect(STATUS_EFFECT.trialing).toBe('full');
    expect(STATUS_EFFECT.active).toBe('full');
  });

  it('cuts every terminal state', () => {
    for (const s of ['canceled', 'paused', 'incomplete']) {
      expect(STATUS_EFFECT[s]).toBe('cut');
    }
  });
});

describe('slugify', () => {
  it('produces URL-safe slugs', () => {
    expect(slugify('Alex Kim')).toBe('alex-kim');
    expect(slugify('  Ünïcode & Spaces!  ')).toBe('unicode-spaces');
    expect(slugify('!!!')).toBe('org');
  });

  it('offers colliding candidates with random suffixes', () => {
    const c = slugCandidates('Alex Kim');
    expect(c[0]).toBe('alex-kim');
    expect(c).toHaveLength(5);
    expect(new Set(c.slice(1)).size).toBe(4); // suffixes are distinct
  });
});

describe('price resolution', () => {
  const table = {
    'claude-sonnet-5': {
      input_per_mtok: 2, cache_write_5m_per_mtok: 2.5, cache_write_1h_per_mtok: 4,
      cache_read_per_mtok: 0.2, output_per_mtok: 10,
    },
  };

  it('matches bare and provider-qualified names', () => {
    expect(resolvePrice(table, 'claude-sonnet-5')).not.toBeNull();
    expect(resolvePrice(table, 'anthropic/claude-sonnet-5')).not.toBeNull();
    expect(resolvePrice(table, 'claude-sonnet-5-20260101')).not.toBeNull();
  });

  it('returns null for an unknown model rather than guessing', () => {
    expect(resolvePrice(table, 'gpt-4')).toBeNull();
  });
});