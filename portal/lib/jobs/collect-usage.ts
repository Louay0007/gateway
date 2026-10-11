/**
 * Usage collector — LiteLLM spend logs → portal.usage_records
 *
 * Two rules this file exists to enforce:
 *
 *  1. IDEMPOTENT. We poll a window. Any restart, timeout, or network blip
 *     replays rows. `dedupe_hash` + ON CONFLICT DO NOTHING is the only
 *     thing standing between a retry and double-billing a customer.
 *     PLATFORM.md §7.4.
 *
 *  2. TTL-AWARE PRICING. `cache_creation_input_tokens` is a single merged
 *     field. Pricing it all at the 5-minute rate under-bills 1-hour-TTL
 *     workloads by roughly 19%. We read ephemeral_5m / ephemeral_1h
 *     separately and FLAG rows where the breakdown is absent.
 *     BLUEPRINT.md §8.3.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getSpendLogs, type SpendLogRow } from '@/lib/litellm/client';
import { priceUsage, loadPriceTable, type PriceTable } from '@/lib/pricing';

const PRICE_VERSION = '2026-10-11';   // bump when prices/models.yaml changes

interface NormalisedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  ttlBreakdownMissing: boolean;
}

/**
 * Map LiteLLM's response usage fields onto the four billable classes.
 * Handles both OpenAI-shaped and Anthropic-shaped field names, because the
 * gateway serves both wire formats and the logs reflect whichever the
 * client used.
 */
function normaliseUsage(u: SpendLogRow['usage']): NormalisedUsage {
  const input        = u?.prompt_tokens ?? 0;
  const output       = u?.completion_tokens ?? 0;
  const creationTot  = u?.cache_creation_input_tokens ?? 0;
  const read         = u?.cache_read_input_tokens ?? 0;

  const cc = u?.cache_creation ?? {};
  let w5 = cc.ephemeral_5m_input_tokens ?? 0;
  let w1 = cc.ephemeral_1h_input_tokens ?? 0;

  // The merged field with no TTL breakdown. Fall back to the 5m rate and
  // flag it — do NOT silently assume 5m.
  let ttlBreakdownMissing = false;
  if (creationTot > 0 && w5 === 0 && w1 === 0) {
    w5 = creationTot;
    ttlBreakdownMissing = true;
  }

  return {
    inputTokens:     input,
    outputTokens:    output,
    cacheWrite5m:    w5,
    cacheWrite1h:    w1,
    cacheRead:       read,
    ttlBreakdownMissing,
  };
}

/**
 * Dedupe hash. Must be stable across retries AND unique per real request.
 * LiteLLM's request_id is the strongest component when present; the token
 * hash + start time + model fallback covers logs that lack it.
 */
function dedupeHash(r: SpendLogRow): string {
  const parts = [
    r.api_key ?? '',
    r.startTime ?? String(r.startTimeSeconds ?? ''),
    r.model ?? '',
    r.request_id ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Map a LiteLLM `team_id` back to our organization. */
async function orgIdForRow(row: SpendLogRow): Promise<string | null> {
  if (!row.team_id) return null;
  const [found] = await db.execute(sql`
    SELECT id FROM organizations WHERE litellm_team_id = ${row.team_id}
  `) as unknown as { id: string }[];
  return found?.id ?? null;
}

export interface CollectResult {
  scanned: number;
  inserted: number;
  skippedDuplicates: number;
  unmapped: number;
  ttlMissing: number;
  window: { start: string; end: string };
}

export async function collectUsage(opts?: {
  lookbackMinutes?: number;
}): Promise<CollectResult> {
  const lookback = opts?.lookbackMinutes ?? 15;

  // Overlap the window. Rows can land slightly after the request completes,
  // so a strict "since last run" boundary silently loses the tail.
  const now = new Date();
  const from = new Date(now.getTime() - lookback * 60_000);

  const startDate = from.toISOString().slice(0, 10);
  const endDate   = now.toISOString().slice(0, 10);

  const prices: PriceTable = await loadPriceTable();

  const result: CollectResult = {
    scanned: 0, inserted: 0, skippedDuplicates: 0,
    unmapped: 0, ttlMissing: 0,
    window: { start: startDate, end: endDate },
  };

  const rows = await getSpendLogs({
    startDate, endDate, page: 1, pageSize: 500,
  });

  for (const row of rows) {
    result.scanned++;
    if (row.startTime && new Date(row.startTime) < from) continue; // outside window

    const orgId = await orgIdForRow(row);
    if (!orgId) { result.unmapped++; continue; }   // not ours; ignore

    const u = normaliseUsage(row.usage);
    if (u.ttlBreakdownMissing) result.ttlMissing++;

    const upstream = row.spend ?? 0;

    // Customer cost = upstream × plan multiplier. The margin gap between
    // these two columns is the business. See PLATFORM.md §3.3.
    const { multiplierBps } = await multiplierForOrg(orgId);
    const customer = upstream * (multiplierBps / 10_000);

    const hash = dedupeHash(row);

    const inserted = await db.execute(sql`
      INSERT INTO usage_records (
        organization_id, api_key_id, occurred_at, billing_period,
        model, route, upstream_key_hash,
        input_tokens, output_tokens,
        cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens,
        latency_ms, status_code,
        cost_upstream_usd, cost_customer_usd,
        price_table_version, dedupe_hash
      )
      SELECT
        ${orgId}::uuid,
        NULL,
        ${row.startTime ?? now.toISOString()}::timestamptz,
        date_trunc('month', ${row.startTime ?? now.toISOString()}::timestamptz)::date,
        ${row.model ?? 'unknown'},
        ${row.endpoint ?? 'unknown'},
        ${row.api_key ?? null},
        ${u.inputTokens}, ${u.outputTokens},
        ${u.cacheWrite5m}, ${u.cacheWrite1h}, ${u.cacheRead},
        NULL,
        NULLIF(${row.status ?? ''}, '')::int,
        ${upstream}, ${customer},
        ${PRICE_VERSION},
        ${hash}
      ON CONFLICT (dedupe_hash) DO NOTHING
      RETURNING id
    `);

    // `db.execute` with postgres-js returns the RowList directly (it is
    // already the array of rows); the `.rows` accessor belongs to the
    // node-postgres driver. Count the returned rows to decide whether the
    // INSERT was a fresh insert or a dedupe hit.
    if (inserted.length > 0) result.inserted++;
    else result.skippedDuplicates++;
  }

  return result;
}

/** Current plan multiplier for an org. Defaults to 1.0 if unknown. */
async function multiplierForOrg(orgId: string): Promise<{ multiplierBps: number }> {
  const [row] = await db.execute(sql`
    SELECT p.rate_multiplier_bps
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ${orgId}::uuid
       AND s.status IN ('trialing','active','past_due','paused')
     LIMIT 1
  `) as unknown as { rate_multiplier_bps: number }[];

  return { multiplierBps: row?.rate_multiplier_bps ?? 10_000 };
}

/**
 * Rebuild period rollups from the immutable ledger.
 *
 * Always derived — never incrementally incremented. An increment that runs
 * twice silently doubles a customer's bill, and you cannot tell from the
 * dashboard which number is wrong.
 */
export async function rollupUsage(): Promise<void> {
  await db.execute(sql`
    INSERT INTO usage_periods (
      organization_id, billing_period, plan_id, rate_multiplier_bps,
      requests, input_tokens, output_tokens, cache_read_tokens,
      cost_upstream_usd, cost_customer_usd, updated_at
    )
    SELECT
      u.organization_id,
      u.billing_period,
      (SELECT plan_id FROM subscriptions
        WHERE organization_id = u.organization_id
          AND status IN ('trialing','active','past_due','paused')
        LIMIT 1),
      (SELECT rate_multiplier_bps FROM plans WHERE id = (
          SELECT plan_id FROM subscriptions
           WHERE organization_id = u.organization_id
             AND status IN ('trialing','active','past_due','paused')
           LIMIT 1)),
      COUNT(*),
      SUM(u.input_tokens),
      SUM(u.output_tokens),
      SUM(u.cache_read_tokens),
      SUM(u.cost_upstream_usd),
      SUM(u.cost_customer_usd),
      now()
    FROM usage_records u
    GROUP BY u.organization_id, u.billing_period
    ON CONFLICT (organization_id, billing_period) DO UPDATE SET
      requests            = EXCLUDED.requests,
      input_tokens        = EXCLUDED.input_tokens,
      output_tokens       = EXCLUDED.output_tokens,
      cache_read_tokens   = EXCLUDED.cache_read_tokens,
      cost_upstream_usd   = EXCLUDED.cost_upstream_usd,
      cost_customer_usd   = EXCLUDED.cost_customer_usd,
      updated_at          = now()
  `);
}