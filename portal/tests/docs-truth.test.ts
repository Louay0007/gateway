/**
 * Docs truth — the published integration guide must not contradict the
 * system it documents.
 *
 * The bug this exists to prevent, found on 2026-11-13: `/docs` listed
 * `smart` as "Pro" only while the live plan table said
 * `starter = {fast, smart}`. A developer reads the docs, calls
 * `GET /v1/models` with a Starter key, and the two disagree — at which
 * point every other number on the page (rates, limits, the meter itself)
 * becomes suspect.
 *
 * These assertions are PURE: they read the docs data module and the
 * shipping migration rather than a live database, so they run in CI
 * without Postgres. The migration is the schema-of-record for what the
 * plan table holds, which is what makes it a valid mirror.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  TIERS,
  POOL_PLANS,
  TRIAL,
  POOL_NOTE,
  CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  PUBLIC_BASE_URL,
} from '@/components/docs/docs-data';

const REPO_ROOT = new URL('../../', import.meta.url);
const sql = readFileSync(
  new URL('portal/db/migrations/0039_pool_totals.sql', REPO_ROOT),
  'utf8',
);

describe('docs alias catalog', () => {
  it('lists exactly the four aliases the gateway serves', () => {
    expect(TIERS.map((t) => t.alias)).toEqual([
      'fast',
      'smart',
      'frontier',
      'fable',
    ]);
  });

  it('never renders an upstream model id as a customer-visible alias', () => {
    // `poweredBy` is a display label, but it must stay an alias-family
    // name — not "haiku-5.5"/"sonnet-5.5"/"gpt-6-astra".
    for (const t of TIERS) {
      expect(t.poweredBy.toLowerCase()).not.toMatch(
        /haiku-5\.5|sonnet-5\.5|opus-5\.5|gpt-6|anthropic|openai/,
      );
      expect(t.alias).toMatch(/^(fast|smart|frontier|fable)$/);
    }
  });
});

describe('docs plan mapping matches the plan table', () => {
  const modelsFor = (code: string): string[] => {
    const tier = TIERS.filter((t) => t.plans.toLowerCase().includes(
      code === 'starter' ? 'starter' : 'pro',
    ));
    return tier.map((t) => t.alias);
  };

  it('smart is in BOTH plans (the 2026-11-13 bug)', () => {
    // Live table: starter = {fast, smart}; pro = {smart, frontier, fable}.
    const starter = modelsFor('starter');
    const pro = modelsFor('pro');
    expect(starter).toContain('fast');
    expect(starter).toContain('smart');
    expect(pro).toContain('smart');
    expect(pro).toContain('frontier');
    expect(pro).toContain('fable');
  });

  it('frontier and fable are Pro-only', () => {
    const starter = modelsFor('starter');
    expect(starter).not.toContain('frontier');
    expect(starter).not.toContain('fable');
  });

  it('POOL_PLANS model lists agree with the same mapping', () => {
    const starter = POOL_PLANS.find((p) => p.code === 'starter');
    const pro = POOL_PLANS.find((p) => p.code === 'pro');
    expect(starter?.models).toEqual(['fast', 'smart']);
    expect(pro?.models).toEqual(['smart', 'frontier', 'fable']);
  });
});

describe('docs allowances match migration 0039', () => {
  it('Starter and Pro both publish a 50M pool', () => {
    expect(sql).toContain('{"fast": 50000000}');
    expect(sql).toContain('{"smart": 50000000}');

    for (const p of POOL_PLANS) {
      expect(p.tokens).toBe(50_000_000);
      expect(p.tokensLabel).toBe('50M');
    }
  });

  it('the trial publishes 1M, matching the plan row', () => {
    expect(sql).toContain('{"fast": 1000000}');
    expect(TRIAL.tokens).toBe(1_000_000);
    expect(TRIAL.tokensLabel).toBe('1M');
    expect(TRIAL.days).toBe(3);
  });

  it('every plan states the pool is SHARED, never per model', () => {
    // A docs page that implies a per-model ceiling makes a developer stop
    // at a number the wall never enforces.
    expect(POOL_NOTE.toLowerCase()).toContain('shared pool');
    expect(POOL_NOTE.toLowerCase()).toContain('any model');
    for (const p of POOL_PLANS) {
      expect(p.tokens).toBe(
        (p as unknown as { perAlias?: number }).perAlias ?? p.tokens,
      );
    }
  });
});

describe('docs technical constants', () => {
  it('context and output limits match the gateway deployment', () => {
    // Mirrored in config/litellm.yaml max_input_tokens / max_output_tokens.
    expect(CONTEXT_WINDOW).toBe(1_048_576);
    expect(MAX_OUTPUT_TOKENS).toBe(65_536);
  });

  it('the documented base URL is the production edge', () => {
    expect(PUBLIC_BASE_URL).toBe('https://api.zaino.soon.it/v1');
  });
});
