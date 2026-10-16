/**
 * ONE table, TWO consumers — proven.
 *
 * config/litellm.yaml's model_info and prices/models.yaml each carry the same
 * rates. They have drifted before (the §5.20 upstream change moved one and
 * not the other), and the failure is silent and expensive in opposite
 * directions:
 *
 *   - litellm.yaml HIGHER than the price table -> the gateway bills the
 *     customer less than it meters, so margin silently goes negative.
 *   - litellm.yaml LOWER -> customers are overcharged relative to the
 *     advertised rate.
 *
 * Nothing at runtime compares them, so this test is the only thing standing
 * between a bad edit and either outcome. It parses both files from disk
 * rather than importing them, because it must catch an edit to either file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolvePrice } from '@/lib/pricing/index';

const LITELLM_YAML = new URL('../../config/litellm.yaml', import.meta.url);
const PRICES_YAML = new URL('../../prices/models.yaml', import.meta.url);
const REPO_ROOT = new URL('../../', import.meta.url);

const M = 1_000_000;
/** Anything smaller than this is a rounding artifact, not a rate mismatch. */
const EPSILON = 1e-12;

/** Strip `#` comments and blank lines so a hand-rolled parse cannot trip. */
function stripComments(yaml: string): string[] {
  return yaml
    .split('\n')
    .map((l) => l.replace(/\s+#.*$/, ''))
    .filter((l) => l.trim().length > 0);
}

/** The bare model id: `openai/nvidia/nemotron-3.5-super-vl-120b-a12b` -> `nemotron-3.5-super-vl-120b-a12b`. */
function bareModel(openaiId: string): string {
  return openaiId.split('/').pop()!;
}
// ── parse config/litellm.yaml ──────────────────────────────────────────────

interface Deployment {
  alias: string;
  model: string;
  bare: string;
  input: number;
  output: number;
  cacheWrite1h: number;
  cacheRead: number;
  endpoints: string[];
  numRetries: number | null;
  cooldown: number | null;
}

function parseLiteLLM(): Deployment[] {
  const lines = stripComments(readFileSync(LITELLM_YAML, 'utf8'));
  const out: Deployment[] = [];

  let alias: string | null = null;
  let inModelInfo = false;
  let inParams = false;
  let d: Partial<Deployment> = {};

  const flush = () => {
    if (alias && d.model) {
      out.push({
        alias,
        model: d.model,
        bare: bareModel(d.model),
        input: d.input ?? 0,
        output: d.output ?? 0,
        cacheWrite1h: d.cacheWrite1h ?? 0,
        cacheRead: d.cacheRead ?? 0,
        endpoints: d.endpoints ?? [],
        numRetries: d.numRetries ?? null,
        cooldown: d.cooldown ?? null,
      });
    }
    alias = null;
    d = {};
    inModelInfo = false;
    inParams = false;
  };

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const t = line.trim();

    const aliasMatch = /^- model_name:\s*(\S+)$/.exec(t);
    if (aliasMatch) {
      flush();
      alias = aliasMatch[1]!;
      continue;
    }
    if (alias === null) continue;

    if (/^litellm_params:$/.test(t)) { inParams = true; inModelInfo = false; continue; }
    if (/^model_info:$/.test(t)) { inModelInfo = true; inParams = false; continue; }

    if (inParams) {
      const m = /^model:\s*(\S+)$/.exec(t);
      if (m) d.model = m[1]!;
      const n = /^num_retries:\s*(\d+)$/.exec(t);
      if (n) d.numRetries = Number(n[1]);
      const c = /^cooldown_time:\s*(\d+)$/.exec(t);
      if (c) d.cooldown = Number(c[1]);
      // Anything else at this level ends the block.
      if (/^[a-z_]+:$/.test(t) && !/^(litellm_params|model_info):$/.test(t)) inParams = false;
    } else if (inModelInfo) {
      const e = /^supported_endpoints:\s*\[(.*)\]$/.exec(t);
      if (e) d.endpoints = e[1]!.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const i = /^input_cost_per_token:\s*([0-9.eE-]+)$/.exec(t);
      if (i) d.input = Number(i[1]);
      const o = /^output_cost_per_token:\s*([0-9.eE-]+)$/.exec(t);
      if (o) d.output = Number(o[1]);
      const c1 = /^cache_creation_input_token_cost:\s*([0-9.eE-]+)$/.exec(t);
      if (c1) d.cacheWrite1h = Number(c1[1]);
      const cr = /^cache_read_input_token_cost:\s*([0-9.eE-]+)$/.exec(t);
      if (cr) d.cacheRead = Number(cr[1]);
      if (/^[a-z_]+:$/.test(t)) inModelInfo = false;
    }
    void indent;
  }
  flush();
  return out;
}

// ── parse prices/models.yaml ──────────────────────────────────────────────

type PriceRow = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_5m_per_mtok: number;
  cache_write_1h_per_mtok: number;
  cache_read_per_mtok: number;
};

function parsePrices(): Record<string, PriceRow> {
  const table: Record<string, PriceRow> = {};
  let key: string | null = null;
  let row: Record<string, number> = {};

  const flush = () => {
    if (key) {
      table[key] = {
        input_per_mtok: row.input_per_mtok ?? 0,
        output_per_mtok: row.output_per_mtok ?? 0,
        cache_write_5m_per_mtok: row.cache_write_5m_per_mtok ?? 0,
        cache_write_1h_per_mtok: row.cache_write_1h_per_mtok ?? 0,
        cache_read_per_mtok: row.cache_read_per_mtok ?? 0,
      };
    }
    key = null;
    row = {};
  };

  for (const line of stripComments(readFileSync(PRICES_YAML, 'utf8'))) {
    const t = line.trim();
    if (/^models:$/.test(t)) continue;

    const head = /^([A-Za-z0-9._:@-]+):$/.exec(t);
    const indent = line.length - line.trimStart().length;
    if (head && indent === 2) {
      flush();
      key = head[1]!;
      continue;
    }
    const kv = /^([a-z0-9_]+):\s+([0-9.eE+-]+)$/.exec(t);
    if (kv && indent === 4 && key) row[kv[1]!] = Number(kv[2]);
  }
  flush();
  return table;
}

const deployments = parseLiteLLM();
const priceTable = parsePrices();

describe('litellm.yaml <-> prices/models.yaml', () => {
  it('parses every deployment out of litellm.yaml (the test is not vacuous)', () => {
    expect(deployments.length).toBeGreaterThanOrEqual(1);
    for (const d of deployments) {
      expect(d.model, `deployment "${d.alias}" has no model`).toMatch(/^openai\/.+/);
    }
  });

  it('prices every deployment the gateway can actually serve', () => {
    const missing = deployments.filter((d) => !priceTable[d.bare] && !resolvePrice(priceTable, d.model));
    expect(
      missing.map((d) => `${d.alias} -> ${d.model}`),
      'these deployments have no row in prices/models.yaml, so their spend is unpriced',
    ).toEqual([]);
  });

  it('has no orphan price rows for models the gateway does not serve', () => {
    const served = new Set(deployments.map((d) => d.bare));
    const orphans = Object.keys(priceTable).filter((k) => !served.has(k));
    expect(
      orphans,
      'these price rows are for models no deployment uses — dead config that will drift',
    ).toEqual([]);
  });

  it('resolves each alias to its own tier via resolvePrice, longest key first', () => {
    // `nemotron-3.5-super-vl-120b-a12b` is its own key so it never collapses
    // into a broader prefix. LiteLLM reports `openai/nvidia/nemotron-…` and
    // the upstream answers `"model":"nemotron-3.5-super-vl-120b-a12b"` —
    // both must resolve to the same price row.
    const prefixed = resolvePrice(priceTable, 'openai/nvidia/nemotron-3.5-super-vl-120b-a12b');
    const bare = resolvePrice(priceTable, 'nemotron-3.5-super-vl-120b-a12b');
    expect(prefixed).toBeTruthy();
    expect(bare).toBeTruthy();
    expect(prefixed).toBe(priceTable['nemotron-3.5-super-vl-120b-a12b']);
    expect(bare).toBe(priceTable['nemotron-3.5-super-vl-120b-a12b']);
    // The two forms must resolve identically — prefix matching is an alias,
    // not a re-classification.
    expect(prefixed).toBe(bare);
  });

  it('has IDENTICAL rates for every deployment inside one alias', () => {
    // reconcile.sh maps an alias to ONE representative model. That is only
    // sound while a tier is internally uniform.
    const byAlias = new Map<string, Deployment[]>();
    for (const d of deployments) {
      byAlias.set(d.alias, [...(byAlias.get(d.alias) ?? []), d]);
    }
    for (const [alias, group] of byAlias) {
      const first = group[0]!;
      for (const d of group.slice(1)) {
        expect(d.input, `${alias}: ${d.bare} input differs from ${first.bare}`).toBeCloseTo(first.input, 12);
        expect(d.output, `${alias}: ${d.bare} output differs from ${first.bare}`).toBeCloseTo(first.output, 12);
        expect(d.cacheRead, `${alias}: ${d.bare} cache-read differs from ${first.bare}`).toBeCloseTo(first.cacheRead, 12);
      }
    }
  });

  it('agrees, per token, between litellm.yaml and prices/models.yaml', () => {
    for (const d of deployments) {
      const price = priceTable[d.bare] ?? resolvePrice(priceTable, d.model);
      if (!price) continue;
      const label = `${d.alias}/${d.bare}`;
      expect(Math.abs(d.input - price.input_per_mtok / M), `${label} input`).toBeLessThan(EPSILON);
      expect(Math.abs(d.output - price.output_per_mtok / M), `${label} output`).toBeLessThan(EPSILON);
      expect(Math.abs(d.cacheWrite1h - price.cache_write_1h_per_mtok / M), `${label} cache-write-1h`).toBeLessThan(EPSILON);
      expect(Math.abs(d.cacheRead - price.cache_read_per_mtok / M), `${label} cache-read`).toBeLessThan(EPSILON);
      // LiteLLM has ONE cache_creation_input_token_cost field and cannot
      // distinguish 5m from 1h, so it is set to the 1h tier. If it were ever
      // lowered to the 5m rate, cache writes would silently under-bill.
      expect(
        Math.abs(d.cacheWrite1h - price.cache_write_1h_per_mtok / M),
        `${label} cache-write must mirror the 1h tier, not 5m`,
      ).toBeLessThan(EPSILON);
    }
  });

  it('rates every alias above zero, so a budget is never a no-op', () => {
    // With one tier, the budget's floor must still be non-zero — otherwise
    // every spend check passes vacuously and pipeline bugs hide.
    const rateOf = (alias: string) =>
      (priceTable[deployments.find((d) => d.alias === alias)!.bare] ?? {}).input_per_mtok ?? 0;
    for (const d of deployments) {
      expect(rateOf(d.alias), `${d.alias} has a zero input rate`).toBeGreaterThan(0);
    }
  });

  it('only declares endpoints the upstream actually serves', () => {
    // The upstream 404s on /v1/responses. If a future edit declares it,
    // LiteLLM forwards into a 404 and codex-cli dies — the exact bug §5.22
    // was built to work around.
    for (const d of deployments) {
      expect(d.endpoints, `${d.bare} declares an endpoint the upstream lacks`).toEqual([
        '/v1/chat/completions',
      ]);
    }
  });

  it('gives every deployment a retry budget, so one bad pool cannot end a run', () => {
    // codex-cli gave up with "exceeded retry limit, last status: 429". The
    // retry has to happen here for the client never to see it.
    for (const d of deployments) {
      expect(d.numRetries, `${d.bare} has no num_retries`).toBeGreaterThanOrEqual(3);
      expect(d.cooldown, `${d.bare} has no cooldown_time`).toBeGreaterThan(0);
    }
  });

  it('registers every deployment under `aliases:`, so the ledger can name it', () => {
    // collect-usage.ts resolves the gateway's model to an alias before writing
    // usage_records. A deployment with no entry resolves to `unknown`, which
    // analytics then shows instead of a tier — invisibly breaking the
    // customer-visible dashboard while the price rows stay correct.
    const registered = (() => {
      // `parsePrices()` strips everything but rate rows, so the registry is
      // read separately. Sharing the same parse would give the test the same
      // blind spot it is checking for.
      const raw = readFileSync(PRICES_YAML, 'utf8');
      const inBlock = raw.slice(raw.indexOf('aliases:'));
      const out: Record<string, string> = {};
      for (const m of inBlock.matchAll(/^  ([A-Za-z0-9._:@-]+):\s+fast\s*$/gm)) {
        out[m[1]!] = m[2]!;
      }
      return out;
    })();
    expect(Object.keys(registered).length, 'prices/models.yaml has an empty `aliases:` registry').toBeGreaterThan(0);
    const missing = deployments.filter((d) => !(d.bare in registered));
    expect(
      missing.map((d) => d.bare),
      'these deployments have no alias and would land as `unknown` in analytics',
    ).toEqual([]);
    // No alias may point at a model the gateway does not serve — the reverse
    // drift: a tier entry for a model that was removed.
    const served = new Set(deployments.map((d) => d.bare));
    const stale = Object.entries(registered)
      .filter(([model]) => !served.has(model))
      .map(([model]) => model);
    expect(stale, 'alias entries for models no deployment serves').toEqual([]);
  });
});

describe('scripts/reconcile.sh alias map', () => {
  const reconcile = readFileSync(new URL('scripts/reconcile.sh', REPO_ROOT), 'utf8');

  it('maps every alias the gateway serves to a model that exists', () => {
    const block = /ALIAS = \{([\s\S]*?)\}/.exec(reconcile);
    expect(block, 'ALIAS map not found in reconcile.sh').toBeTruthy();
    const entries = [...block![1]!.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const [, alias, model] of entries) {
      expect(deployments.some((d) => d.alias === alias), `reconcile.sh maps unknown alias "${alias}"`).toBe(true);
      expect(
        deployments.some((d) => d.bare === model),
        `reconcile.sh maps "${alias}" to "${model}", which no deployment serves`,
      ).toBe(true);
    }
  });

  it('covers every alias the gateway serves', () => {
    const block = /ALIAS = \{([\s\S]*?)\}/.exec(reconcile)!;
    const mapped = new Set([...block[1]!.matchAll(/"([^"]+)":/g)].map((m) => m[1]!));
    const served = new Set(deployments.map((d) => d.alias));
    expect([...served].filter((a) => !mapped.has(a)), 'aliases with no reconcile.sh mapping').toEqual([]);
  });
});
