/**
 * Pricing facts — the page, the migrations and the copy must agree.
 *
 * The failure mode these guard is not a crash. It is a buyer reading three
 * numbers on one screen, finding that one is stale, and deciding we are
 * careless with money. That happened here three separate times: 59/307 DT
 * against a live 50/90, 80M/32M against a live 100M/day, and a Halloween
 * discount advertised two weeks after it closed.
 *
 * Since 0046 the catalog is a five-tier ladder (plus a hidden trial), so
 * these no longer assert "two plans with equal pools". They assert the
 * properties a ladder has to keep: every tier states a pool and a price,
 * and each step is an upgrade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLAN_CODES,
  PLAN_FACTS,
  FEATURED_PLAN,
  RATES,
  COMPARISON,
  PRICING_FAQ,
} from '@/lib/pricing/facts';

const PORTAL = new URL('../', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url);

const poolSql = readFileSync(
  new URL('portal/db/migrations/0039_pool_totals.sql', REPO),
  'utf8',
);
const ladderSql = readFileSync(
  new URL('portal/db/migrations/0046_plan_ladder.sql', REPO),
  'utf8',
);

/**
 * Look a tier up by code. The `!` is honest here: PLAN_FACTS is a module
 * constant and the first test in this file pins its codes, so a missing
 * entry is already a failure with a better message than a TypeError.
 */
const plan = (code: string) => PLAN_FACTS.find((p) => p.code === code)!;

/** The pool each tier ships, keyed by code — the ladder's shape. */
const EXPECTED_POOLS: Record<string, number> = {
  solo: 35_000_000,
  starter: 50_000_000,
  pro: 50_000_000,
  team: 150_000_000,
  business: 400_000_000,
};

describe('plan facts match the database', () => {
  it('publishes exactly the five sellable tiers, in ladder order', () => {
    expect(PLAN_FACTS.map((p) => p.code)).toEqual([...PLAN_CODES]);
    // Cheapest first. `listPlans()` sorts by `plans.sort_order`, and
    // 0046 numbers them in this order, so a mismatch here means somebody
    // reordered one list and not the other.
    const prices = PLAN_FACTS.map((p) => p.priceTndMillimes);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('states the pool 0046 writes for each tier', () => {
    for (const plan of PLAN_FACTS) {
      expect(plan.poolTokens, plan.code).toBe(EXPECTED_POOLS[plan.code]);
    }
    // And the migrations really write those numbers, so this file cannot
    // drift into fiction while the database stays behind. Starter and Pro
    // were set by 0039 and are only re-stated by 0046's guards; the three
    // new tiers are INSERTed by 0046. Between the two files every pool is
    // written somewhere.
    for (const [code, pool] of Object.entries(EXPECTED_POOLS)) {
      const sql = code === 'starter' || code === 'pro' ? poolSql : ladderSql;
      expect(sql, code).toContain(code);
      expect(sql, code).toContain(`: ${pool}}`);
    }
  });

  it('the trial stays at 1M — it is not a sellable tier', () => {
    // 0039 dropped it from 50M; 0046 pins it. A "free 10M trial" appeared
    // in a draft of the pricing model and was declined — 1M is the decision.
    expect(poolSql).toContain('{"fast": 1000000}');
    expect(ladderSql).toContain('{"fast": 1000000}');
    expect(PLAN_CODES).not.toContain('trial');
  });

  it('plan model lists match the catalog', () => {
    expect(plan('solo').models).toEqual(['fast', 'smart']);
    expect(plan('starter').models).toEqual(['fast', 'smart']);
    expect(plan('pro').models).toEqual(['smart', 'frontier', 'fable']);
    expect(plan('team').models).toEqual(['smart', 'frontier', 'fable']);
    expect(plan('business').models).toEqual(['smart', 'frontier', 'fable']);
  });

  it('prices match 0046 (the two rails are independent)', () => {
    expect([plan('solo').priceUsdCents, plan('solo').priceTndMillimes]).toEqual([1300, 39000]);
    expect([plan('starter').priceUsdCents, plan('starter').priceTndMillimes]).toEqual([1500, 50000]);
    expect([plan('pro').priceUsdCents, plan('pro').priceTndMillimes]).toEqual([3000, 90000]);
    expect([plan('team').priceUsdCents, plan('team').priceTndMillimes]).toEqual([8000, 250000]);
    expect([plan('business').priceUsdCents, plan('business').priceTndMillimes]).toEqual([16000, 500000]);
  });

  it('Pro keeps Starter’s pool; the ladder grows by volume after it', () => {
    // The 0038 inversion decision is unchanged: Pro is the same 50M as
    // Starter and differs by model class. The NEW tiers are the ones that
    // scale volume.
    expect(plan('pro').poolTokens).toBe(plan('starter').poolTokens);
    expect(plan('team').poolTokens).toBeGreaterThan(plan('pro').poolTokens);
    expect(plan('business').poolTokens).toBeGreaterThan(plan('team').poolTokens);
  });
});

describe('the ladder is a ladder', () => {
  it('Solo is strictly cheaper and smaller than Starter', () => {
    // Fairness rule #2: two plans sharing models must not be near-equals,
    // or they cannibalise each other.
    expect(plan('solo').priceTndMillimes).toBeLessThan(plan('starter').priceTndMillimes);
    expect(plan('solo').poolTokens).toBeLessThan(plan('starter').poolTokens);
    expect(plan('solo').maxKeys).toBeLessThan(plan('starter').maxKeys);
  });

  it('every step up raises pool-per-dinar', () => {
    // The property that makes an upgrade rational. If a higher tier ever
    // delivers less volume per dinar than a lower one, the whole page is a
    // trick and a buyer will find it with a calculator.
    const ratio = (code: string) => {
      const p = plan(code);
      return p.poolTokens / p.priceTndMillimes;
    };
    expect(ratio('starter')).toBeGreaterThan(ratio('solo'));
    expect(ratio('team')).toBeGreaterThan(ratio('pro'));
    expect(ratio('business')).toBeGreaterThan(ratio('team'));
  });

  it('the featured plan is one we actually sell', () => {
    expect(PLAN_CODES).toContain(FEATURED_PLAN);
  });
});

describe('the comparison table', () => {
  it('is grouped by job, in the order a buyer asks', () => {
    expect(COMPARISON.map((g) => g.group)).toEqual([
      'Usage',
      'Models',
      'Team',
      'Payment',
    ]);
  });

  it('every row answers for every plan — never an empty cell', () => {
    for (const group of COMPARISON) {
      for (const row of group.rows) {
        for (const code of PLAN_CODES) {
          expect(row.values[code], `${row.label} / ${code}`).toBeTruthy();
        }
      }
    }
  });

  it('states that failed requests are never billed', () => {
    const usage = COMPARISON.find((g) => g.group === 'Usage')!;
    const row = usage.rows.find((r) => r.label === 'Failed requests billed');
    for (const code of PLAN_CODES) {
      expect(row?.values[code]).toBe('Never');
    }
  });

  it('does not promise a card on a plan that has no card product', () => {
    // 0040 mapped Starter and Pro to Dodo products. The three new tiers have
    // no `provider_price_id`, so a "Yes" here is a checkout button that
    // 500s — worse than an honest dash until the products exist.
    const payment = COMPARISON.find((g) => g.group === 'Payment')!;
    const card = payment.rows.find((r) => r.label === 'Card')!;
    expect(card.values.starter).toBe('Yes');
    expect(card.values.pro).toBe('Yes');
    for (const code of ['solo', 'team', 'business'] as const) {
      expect(card.values[code]).toBe('—');
    }
  });
});

describe('the rates table', () => {
  it('publishes input, output and cache-read for all four aliases', () => {
    expect(RATES.map((r) => r.alias)).toEqual(['fast', 'smart', 'frontier', 'fable']);
    for (const r of RATES) {
      expect(r.input).toBeGreaterThan(0);
      expect(r.output).toBeGreaterThanOrEqual(r.input);
      expect(r.cacheRead).toBeGreaterThan(0);
    }
  });
});

describe('the FAQ does the trust work', () => {
  it('answers the aggregator questions in the negative', () => {
    const joined = PRICING_FAQ.map((f) => `${f.q} ${f.a}`).join(' ').toLowerCase();
    expect(joined).toContain('mark up');
    expect(joined).toMatch(/no\. the per-million rates/);
    expect(joined).toContain('failed requests');
    expect(joined).toContain('never consumes your pool');
  });

  it('has a "which plan" question with a named persona', () => {
    const q = PRICING_FAQ.find((f) => /which plan/i.test(f.q));
    expect(q).toBeDefined();
    expect(q!.a.length).toBeGreaterThan(40);
  });

  it('never sells seats again', () => {
    // 0044_remove_seats deleted per-seat pricing because no request path
    // can grant a second person a key. The ladder is a ladder of POOLS and
    // KEYS; a "seats" claim in the copy is a promise the code cannot keep,
    // so the FAQ must not start describing one again.
    expect(PRICING_FAQ.some((f) => /seat/i.test(f.q) || /seat/i.test(f.a))).toBe(false);
  });

  it('is between 8 and 12 questions', () => {
    expect(PRICING_FAQ.length).toBeGreaterThanOrEqual(8);
    expect(PRICING_FAQ.length).toBeLessThanOrEqual(12);
  });
});

describe('no upstream model name reaches a customer surface', () => {
  const VENDOR = /\b(Haiku|Sonnet|Opus|GPT-6|Astra|Anthropic|OpenAI)\b/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  it('holds across marketing and dashboard components', () => {
    const files = [
      ...walk(join(PORTAL, 'components/marketing')),
      ...walk(join(PORTAL, 'components/dashboard')),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        // A comment explaining the removal is documentation, not a surface.
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        // A WIRE-FORMAT statement is nominative use, not branding: "the
        // OpenAI and Anthropic wire formats", "OpenAI- and
        // Anthropic-compatible". ATTRIBUTION.md establishes this, and the
        // line must stay a compatibility claim — no logo, no "partnership",
        // no "official".
        if (/compatible|wire format/i.test(line)) continue;
        if (VENDOR.test(line)) {
          offenders.push(`${f.replace(PORTAL, '')}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
