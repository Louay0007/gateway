/**
 * Pricing facts — the page, the migrations and the copy must agree.
 *
 * The failure mode these guard is not a crash. It is a buyer reading three
 * numbers on one screen, finding that one is stale, and deciding we are
 * careless with money. That happened here three separate times: 59/307 DT
 * against a live 50/90, 80M/32M against a live 100M/day, and a Halloween
 * discount advertised two weeks after it closed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLAN_FACTS,
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
const priceSql = readFileSync(
  new URL('portal/db/migrations/0037_dodo_and_seat_prices.sql', REPO),
  'utf8',
);

describe('plan facts match the database', () => {
  it('both plans publish the 50M pool migration 0039 sets', () => {
    expect(poolSql).toContain('{"fast": 50000000}'); // starter
    expect(poolSql).toContain('{"smart": 50000000}'); // pro
    for (const p of PLAN_FACTS) {
      expect(p.poolTokens).toBe(50_000_000);
      expect(p.poolLabel).toBe('50M');
    }
  });

  it('plan model lists match the catalog', () => {
    const starter = PLAN_FACTS.find((p) => p.code === 'starter')!;
    const pro = PLAN_FACTS.find((p) => p.code === 'pro')!;
    expect(starter.models).toEqual(['fast', 'smart']);
    expect(pro.models).toEqual(['smart', 'frontier', 'fable']);
  });

  it('prices match migration 0037 (the two rails are independent)', () => {
    // 0037 made price_cents the USD ask and price_tnd_millimes the exact
    // dinar ask, and neither is derived from the other at a rate.
    expect(priceSql.toLowerCase()).toContain('price_tnd_millimes');
    const starter = PLAN_FACTS.find((p) => p.code === 'starter')!;
    const pro = PLAN_FACTS.find((p) => p.code === 'pro')!;
    expect([starter.priceUsdCents, starter.priceTndMillimes]).toEqual([1500, 50000]);
    expect([pro.priceUsdCents, pro.priceTndMillimes]).toEqual([3000, 90000]);
  });

  it('does not claim Pro has more volume than Starter', () => {
    // The inversion decision: equal pools, different models. A later edit
    // "fixing" Pro to a bigger pool has to change the migration too.
    const starter = PLAN_FACTS.find((p) => p.code === 'starter')!;
    const pro = PLAN_FACTS.find((p) => p.code === 'pro')!;
    expect(pro.poolTokens).toBe(starter.poolTokens);
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

  it('every row has a value for both plans — never an empty cell', () => {
    for (const group of COMPARISON) {
      for (const row of group.rows) {
        expect(row.starter.length, row.label).toBeGreaterThan(0);
        expect(row.pro.length, row.label).toBeGreaterThan(0);
      }
    }
  });

  it('states that failed requests are never billed', () => {
    const usage = COMPARISON.find((g) => g.group === 'Usage')!;
    const row = usage.rows.find((r) => r.label === 'Failed requests billed');
    expect(row?.starter).toBe('Never');
    expect(row?.pro).toBe('Never');
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
