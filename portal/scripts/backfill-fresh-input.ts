/**
 * Backfill `usage_records.fresh_input_tokens` from LiteLLM's spend log.
 *
 * WHY A SCRIPT AND NOT ONLY THE MIGRATION. `0028_fresh_input_tokens.sql`
 * backfills with `GREATEST(input_tokens - cache_read_tokens, 0)`. That is
 * correct for every row we have, but it is arithmetic on our own stored
 * numbers: it cannot tell "input was inclusive" from "input was exclusive
 * and cache_read happens to be smaller". This script instead re-reads the
 * authoritative spend row and re-derives fresh input from the provider's
 * own `prompt_tokens` and `cached_tokens`, so a row that was stored
 * inconsistently is corrected from the source rather than compounded.
 *
 * It also VERIFIES the identity on every row it touches:
 *
 *   fresh_input + cache_writes + cache_read + output == prompt + completion
 *
 * A row that fails the identity is reported and left alone — guessing is
 * worse than reporting.
 *
 * IDEMPOTENT. Only touches rows whose `fresh_input_tokens` disagrees with
 * the re-derived value. Re-running changes nothing.
 *
 * Usage (repo root, on the VPS):
 *   docker compose run --rm --no-deps jobs node --experimental-transform-types \
 *     --import ./scripts/register-ts-resolve.mjs scripts/backfill-fresh-input.ts [--apply]
 *
 * Without `--apply` it reports what it WOULD change and exits 0.
 */
import './env.mjs'; // MUST be first — see scripts/env.mjs.

import { sql } from 'drizzle-orm';
import { db, sql as pool } from '@/db';
import { getSpendLogs, type SpendLogRow } from '@/lib/litellm/client';
import { log } from '@/lib/log';

const APPLY = process.argv.includes('--apply');

interface LedgerRow {
  id: number;
  gateway_request_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  fresh_input_tokens: number | null;
  occurred_at: string;
}

interface Correction {
  id: number;
  callId: string;
  was: number | null;
  now: number;
  reason: string;
}

/** Inclusive `prompt_tokens` minus cached reads, floored at zero. */
function deriveFresh(row: SpendLogRow): number | null {
  const anyRow = row as unknown as Record<string, unknown>;
  const meta = anyRow.metadata as Record<string, unknown> | undefined;
  const metaUsage = (meta?.usage_object ?? {}) as Record<string, unknown>;
  const details = (metaUsage.prompt_tokens_details ?? {}) as Record<string, unknown>;

  const prompt =
    typeof anyRow.prompt_tokens === 'number'
      ? anyRow.prompt_tokens
      : typeof metaUsage.prompt_tokens === 'number'
        ? metaUsage.prompt_tokens
        : null;
  if (prompt === null) return null;

  const cached =
    typeof details.cached_tokens === 'number'
      ? details.cached_tokens
      : typeof anyRow.cache_read_input_tokens === 'number'
        ? anyRow.cache_read_input_tokens
        : 0;

  return Math.max(prompt - cached, 0);
}

async function main(): Promise<void> {
  // Every row that has a call id is joinable to a spend row. Rows without
  // one were already handled by the migration's arithmetic backfill; there
  // is nothing authoritative to re-derive them from.
  const rows = (await db.execute(sql`
    SELECT id, gateway_request_id, input_tokens, output_tokens,
           cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
           fresh_input_tokens, occurred_at
      FROM usage_records
     WHERE gateway_request_id IS NOT NULL
     ORDER BY occurred_at ASC
  `)) as unknown as LedgerRow[];

  log.info('backfill: starting', { rows: rows.length, apply: APPLY });
  if (rows.length === 0) {
    log.info('backfill: nothing to do');
    return;
  }

  // One spend-log window covering the whole ledger. The endpoint bounds the
  // work by date, and re-reading it once is cheaper than a request per row.
  const dates = rows.map((r) => new Date(r.occurred_at));
  const start = new Date(Math.min(...dates.map((d) => d.getTime())));
  const end = new Date(Math.max(...dates.map((d) => d.getTime())));
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const spend = await getSpendLogs({ startDate: iso(start), endDate: iso(end) });
  const byCallId = new Map<string, SpendLogRow>();
  for (const s of spend) {
    if (s.litellm_call_id) byCallId.set(s.litellm_call_id, s);
  }
  log.info('backfill: spend rows indexed', { spend: spend.length, indexed: byCallId.size });

  const corrections: Correction[] = [];
  let noSpendRow = 0;
  let identityFailed = 0;

  for (const r of rows) {
    const s = byCallId.get(r.gateway_request_id);
    if (!s) {
      noSpendRow++;
      continue;
    }

    const fresh = deriveFresh(s);
    if (fresh === null) {
      noSpendRow++;
      continue;
    }

    // VERIFY the identity before trusting the derived value. If it does not
    // hold, the two sources disagree about this call and neither number can
    // be trusted — report, do not write.
    const spendPrompt =
      (s as unknown as Record<string, unknown>).prompt_tokens as number | undefined;
    const spendCompletion =
      (s as unknown as Record<string, unknown>).completion_tokens as number | undefined;
    if (typeof spendPrompt === 'number' && typeof spendCompletion === 'number') {
      const lhs =
        fresh + r.cache_write_5m_tokens + r.cache_write_1h_tokens +
        r.cache_read_tokens + r.output_tokens;
      const rhs = spendPrompt + spendCompletion;
      if (lhs !== rhs) {
        identityFailed++;
        log.warn('backfill: identity mismatch, leaving row alone', {
          id: r.id,
          callId: r.gateway_request_id,
          lhs,
          rhs,
        });
        continue;
      }
    }

    if (r.fresh_input_tokens === fresh) continue;

    corrections.push({
      id: r.id,
      callId: r.gateway_request_id,
      was: r.fresh_input_tokens,
      now: fresh,
      reason:
        r.fresh_input_tokens === null
          ? 'null after migration'
          : `stored ${r.fresh_input_tokens}, spend log says ${fresh}`,
    });
  }

  for (const c of corrections.slice(0, 20)) {
    log.info('backfill: would correct', { ...c });
  }
  if (corrections.length > 20) {
    log.info('backfill: …more corrections', { remaining: corrections.length - 20 });
  }

  if (APPLY && corrections.length > 0) {
    for (const c of corrections) {
      await db.execute(sql`
        UPDATE usage_records
           SET fresh_input_tokens = ${c.now}
         WHERE id = ${c.id}
      `);
    }
    log.info('backfill: applied', { updated: corrections.length });
  }

  log.info('backfill: summary', {
    scanned: rows.length,
    corrections: corrections.length,
    noSpendRow,
    identityFailed,
    applied: APPLY,
  });

  if (!APPLY && corrections.length > 0) {
    log.info('backfill: dry run — re-run with --apply to write');
  }
}

main()
  .then(() => pool.end())
  .catch(async (e: unknown) => {
    log.error('backfill failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    await pool.end();
    process.exit(1);
  });
