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

  it('exposes no engine name at all — the alias is the whole surface', () => {
    // `poweredBy` was removed on 2026-11-13. It carried upstream family
    // names ("Zaino Haiku 5.5") in a product whose promise is that the
    // engine is swappable behind the alias. Guard the removal, so the
    // field cannot come back as a "helpful" addition.
    for (const t of TIERS) {
      expect(Object.keys(t)).not.toContain('poweredBy');
      expect(t.alias).toMatch(/^(fast|smart|frontier|fable)$/);
      const blob = JSON.stringify(t).toLowerCase();
      for (const vendor of ['haiku', 'sonnet', 'opus', 'gpt-', 'anthropic', 'openai']) {
        expect(blob, `${t.alias} mentions ${vendor}`).not.toContain(vendor);
      }
    }
  });
});

describe('docs plan mapping matches the plan table', () => {
  const modelsFor = (code: string): string[] =>
    TIERS.filter((t) => {
      const plans = t.plans.toLowerCase();
      // `smart` ships on every tier, so its row says so rather than
      // listing five names that would drift. Expand it to every code.
      if (/every plan|all plans/.test(plans)) return true;
      return plans.includes(code);
    }).map((t) => t.alias);

  it('smart is on every plan (the 2026-11-13 bug)', () => {
    // Live ladder since 0046: fast/smart on Solo and Starter,
    // smart/frontier/fable on Pro, Team and Business. Smart is universal.
    expect(modelsFor('solo')).toContain('smart');
    expect(modelsFor('starter')).toContain('smart');
    expect(modelsFor('pro')).toContain('smart');
    expect(modelsFor('team')).toContain('smart');
    expect(modelsFor('business')).toContain('smart');
  });

  it('fast is only on the two entry tiers', () => {
    const entry = [...modelsFor('solo'), ...modelsFor('starter')];
    expect(entry).toContain('fast');
    expect(modelsFor('team')).not.toContain('fast');
    expect(modelsFor('business')).not.toContain('fast');
  });

  it('frontier and fable are on the reasoning tiers only', () => {
    const entry = [...modelsFor('solo'), ...modelsFor('starter')];
    expect(entry).not.toContain('frontier');
    expect(entry).not.toContain('fable');
    expect(modelsFor('pro')).toContain('frontier');
    expect(modelsFor('pro')).toContain('fable');
  });

  it('POOL_PLANS model lists agree with the same mapping', () => {
    const models = (code: string) => POOL_PLANS.find((p) => p.code === code)?.models;
    expect(models('solo')).toEqual(['fast', 'smart']);
    expect(models('starter')).toEqual(['fast', 'smart']);
    expect(models('pro')).toEqual(['smart', 'frontier', 'fable']);
    expect(models('team')).toEqual(['smart', 'frontier', 'fable']);
    expect(models('business')).toEqual(['smart', 'frontier', 'fable']);
  });
});

describe('docs allowances match migrations 0039 + 0046', () => {
  it('the two legacy tiers still publish the 50M pool 0039 sets', () => {
    expect(sql).toContain('{"fast": 50000000}');
    expect(sql).toContain('{"smart": 50000000}');
    for (const code of ['starter', 'pro']) {
      const p = POOL_PLANS.find((x) => x.code === code)!;
      expect(p.tokens, code).toBe(50_000_000);
      expect(p.tokensLabel, code).toBe('50M');
    }
  });

  it('the three ladder tiers publish the pools 0046 writes', () => {
    // Solo was trimmed from the proposed 40M to 35M: at 40M/39 DT a customer
    // got MORE volume per dinar than Starter's 50M/50 DT, which makes the
    // tier above it the irrational choice.
    const ladder = readFileSync('db/migrations/0046_plan_ladder.sql', 'utf8');
    const expected: Record<string, [number, string]> = {
      solo: [35_000_000, '35M'],
      team: [150_000_000, '150M'],
      business: [400_000_000, '400M'],
    };
    for (const [code, [tokens, label]] of Object.entries(expected)) {
      const p = POOL_PLANS.find((x) => x.code === code);
      expect(p, code).toBeDefined();
      expect(p!.tokens, code).toBe(tokens);
      expect(p!.tokensLabel, code).toBe(label);
      expect(ladder, code).toContain(`: ${tokens}}`);
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
