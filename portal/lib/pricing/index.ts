/**
 * Cost computation — the single source of truth for what a token costs.
 *
 * Both the portal's invoices and the gateway's reconcile script implement
 * this independently (scripts/reconcile.sh on the gateway). If they ever
 * disagree, reconcile.sh is the one that wins — it runs against raw usage
 * and a versioned price table.
 *
 * The cache-TTL split is not optional: pricing merged cache-creation
 * tokens at the 5-minute rate under-reports 1-hour-TTL workloads by ~19%,
 * which is why `TokenCounts` carries the two buckets separately.
 *
 * INPUT IS EXCLUSIVE OF CACHE. `counts.inputTokens` means fresh tokens
 * only; `cacheRead` is priced at the cache-read rate separately. Feeding
 * a provider's inclusive `prompt_tokens` here double-bills the cached
 * portion — see the note on `TokenCounts.inputTokens`.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { PRICE_FILE } from '@/lib/pricing/path';

export interface ModelPrice {
  input_per_mtok: number;
  cache_write_5m_per_mtok: number;
  cache_write_1h_per_mtok: number;
  cache_read_per_mtok: number;
  output_per_mtok: number;
  long_context?: {
    threshold_tokens: number;
    input_per_mtok: number;
    output_per_mtok: number;
  };
}

export type PriceTable = Record<string, ModelPrice>;

export async function loadPriceTable(): Promise<PriceTable> {
  const raw = await readFile(PRICE_FILE, 'utf8');
  return (parseYaml(raw) as { models: PriceTable }).models;
}

export interface TokenCounts {
  /**
   * Input tokens EXCLUDING cache reads. If you have a provider's
   * `prompt_tokens`, subtract `cacheRead` first — that field is inclusive
   * of the cached portion, and passing it here as-is bills the cached
   * tokens twice (once at the input rate, once at the cache rate).
   * `lib/litellm/client.ts` `extractUsage()` returns the normalised value
   * as `freshInput` for exactly this reason.
   */
  inputTokens: number;
  outputTokens: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  total: number;
}

const M = 1_000_000;

/**
 * Resolve a price row for a model string.
 *
 * LiteLLM may report either the bare model ("claude-sonnet-4-5") or the
 * provider-qualified form ("anthropic/claude-sonnet-4-5"). Match the
 * longest key first so "claude-sonnet-4-5-20250929" resolves before
 * "claude-sonnet-4-5" truncates incorrectly.
 */
export function resolvePrice(table: PriceTable, model: string): ModelPrice | null {
  if (table[model]) return table[model];

  const bare = model.includes('/') ? model.split('/').pop()! : model;

  const candidates = Object.keys(table)
    .filter((k) => bare === k || bare.startsWith(`${k}-`) || bare.startsWith(k))
    .sort((a, b) => b.length - a.length);

  const first = candidates[0];
  return first ? (table[first] ?? null) : null;
}

export function priceUsage(
  counts: TokenCounts,
  price: ModelPrice,
): CostBreakdown {
  const lc = price.long_context;
  const totalInput = counts.inputTokens + counts.cacheWrite5m + counts.cacheWrite1h;
  const useLongContext = lc != null && totalInput >= lc.threshold_tokens;

  const inputRate = useLongContext ? lc.input_per_mtok : price.input_per_mtok;
  const outputRate = useLongContext ? lc.output_per_mtok : price.output_per_mtok;

  const input       = (counts.inputTokens   / M) * inputRate;
  const output      = (counts.outputTokens  / M) * outputRate;
  const cacheWrite5m = (counts.cacheWrite5m / M) * price.cache_write_5m_per_mtok;
  const cacheWrite1h = (counts.cacheWrite1h / M) * price.cache_write_1h_per_mtok;
  const cacheRead    = (counts.cacheRead    / M) * price.cache_read_per_mtok;

  // Round to 8dp — the usage_records column is NUMERIC(14,8). Rounding
  // here rather than at insert keeps rollup sums exact and repeatable.
  const r = (n: number) => Math.round(n * 1e8) / 1e8;
  const total = r(input + output + cacheWrite5m + cacheWrite1h + cacheRead);

  return {
    input: r(input), output: r(output),
    cacheWrite5m: r(cacheWrite5m), cacheWrite1h: r(cacheWrite1h),
    cacheRead: r(cacheRead), total,
  };
}

/**
 * Customer-facing rate. `strategy` is set per business model —
 *
 *   'pass_through'  cached reads bill at 0.1x, same as upstream
 *   'flatten'       no cache discount; all input billed at 1x
 *
 * Flatten yields higher margin per token and must be disclosed on the
 * pricing page. Choosing it silently is how you earn a chargeback.
 */
export function customerCost(
  counts: TokenCounts,
  price: ModelPrice,
  multiplierBps: number,
  strategy: 'pass_through' | 'flatten' = 'pass_through',
): number {
  const m = multiplierBps / 10_000;

  if (strategy === 'flatten') {
    // No cache discount: every input-side token bills at the input rate.
    // `inputTokens` is already exclusive of cache, so the four buckets are
    // disjoint and summing them cannot double-count.
    const allIn = (counts.inputTokens + counts.cacheWrite5m
                 + counts.cacheWrite1h + counts.cacheRead) / M * price.input_per_mtok;
    const out   = counts.outputTokens / M * price.output_per_mtok;
    return Math.round((allIn + out) * m * 1e8) / 1e8;
  }

  return priceUsage(counts, price).total * m;
}

/**
 * Total billable tokens for metering.
 *
 * The four buckets are DISJOINT: `inputTokens` is fresh input (exclusive
 * of cache reads), and the cache buckets are separate. Summing them gives
 * the provider's `prompt_tokens + completion_tokens`, which is the one
 * quantity that must agree between this system and the upstream.
 *
 * Cached reads are counted at full weight here because the meter's own
 * per-tier unit_amount encodes the rate. Keep this a pure count so the
 * billing side owns the pricing and this owns the quantity.
 */
export function billableTokens(c: TokenCounts): number {
  return c.inputTokens + c.outputTokens
       + c.cacheWrite5m + c.cacheWrite1h + c.cacheRead;
}