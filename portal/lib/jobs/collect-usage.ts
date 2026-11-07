/**
 * Usage collector — LiteLLM spend logs → portal.usage_records
 *
 * Two rules this file exists to enforce:
 *
 *  1. IDEMPOTENT. We poll a window. Any restart, timeout, or network blip
 *     replays rows. `dedupe_hash` + ON CONFLICT DO NOTHING is the only
 *     thing standing between a retry and double-billing a customer.
 *
 *  2. TTL-AWARE PRICING. `cache_creation_input_tokens` is a single merged
 *     field. Pricing it all at the 5-minute rate under-bills 1-hour-TTL
 *     workloads by roughly 19%. We read ephemeral_5m / ephemeral_1h
 *     separately and FLAG rows where the breakdown is absent.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { log } from '@/lib/log';
import { getSpendLogs, extractUsage, statusCodeForRow, type SpendLogRow } from '@/lib/litellm/client';
import { priceUsage, loadPriceTable, type PriceTable } from '@/lib/pricing';
import { loadAliasMap, toAlias, aliasForRow, routeForCallType, promptCountForRow, UNKNOWN_ALIAS, type AliasMap } from '@/lib/pricing/alias';

const PRICE_VERSION = '2026-10-15';   // bump when prices/models.yaml changes

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
  /** Resolved model names with no entry under `aliases:`. Should be empty. */
  unmappedModels: string[];
  /**
   * Chat messages whose token/cost backfill threw. Not fatal — the ledger
   * row is written either way — but a non-zero count means the join key
   * stopped lining up and chat spend is silently invisible.
   */
  chatBackfillFailed: number;
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
  const aliasMap: AliasMap = await loadAliasMap();

  const result: CollectResult = {
    scanned: 0, inserted: 0, skippedDuplicates: 0,
    unmapped: 0, ttlMissing: 0, unmappedModels: [], chatBackfillFailed: 0,
    window: { start: startDate, end: endDate },
  };

  const rows = await getSpendLogs({
    startDate, endDate, page: 1, pageSize: 500,
  });

  // Request order matters: the prompt count of a request is derived by
  // comparing it against the one before it for the same key, so the rows
  // have to be walked in the order they were sent.
  rows.sort((a, b) => {
    const left = a.startTime ? new Date(a.startTime).getTime() : 0;
    const right = b.startTime ? new Date(b.startTime).getTime() : 0;
    if (left !== right) return left - right;
    return (a.request_id ?? '').localeCompare(b.request_id ?? '');
  });

  for (const row of rows) {
    result.scanned++;
    if (row.startTime && new Date(row.startTime) < from) continue; // outside window

    // ── Resolve the model to its ALIAS, here, before anything is written.
    //
    // The gateway's spend log reports the RESOLVED upstream model
    // (`openai/space-bunny`, sometimes `space-bunny-free`) in `model`, AND
    // the alias the client requested in `model_group`. Prefer the group: it
    // is the name the customer used, so no registry lookup can misfire on a
    // new upstream spelling. Fall back to mapping `model` for rows whose
    // group is empty.
    //
    // Writing the alias is what makes "the customer surface shows aliases
    // only" true rather than aspirational: there is no later stage that
    // could reintroduce the name.
    const alias = aliasForRow(aliasMap, row);
    if (alias === UNKNOWN_ALIAS && (row.model || row.model_group)) {
      // Loud, not silent. This means a deployed model has no entry under
      // `aliases:` in prices/models.yaml. The row is still recorded (cost is
      // still knowable) but it will read as `unknown` in analytics, which is
      // the point — an unmapped model should be visibly broken, not silently
      // rendering the provider's name on a customer dashboard.
      result.unmappedModels.push(row.model_group || row.model || '?');
    }

    // ── Resolve the ROUTE from the call type, for the same reason.
    //
    // `model` says which model served the request; it says nothing about the
    // wire format. `call_type` is LiteLLM's own vocabulary (`acompletion`,
    // `anthropic_messages`, `aresponses`) and a NOT NULL column in the spend
    // table. Reading `endpoint` instead is what produced the wall of
    // `unknown` the dashboard showed: current rows do not carry it.
    const route = routeForCallType(row.call_type, row.endpoint);

    const orgId = await orgIdForRow(row);
    if (!orgId) { result.unmapped++; continue; }   // not ours; ignore

    const u = extractUsage(row);
    if (u.ttlBreakdownMissing) result.ttlMissing++;

    const upstream = row.spend ?? 0;

    // Customer cost = upstream × plan multiplier. The margin gap between
    // these two columns is the business.
    const { multiplierBps } = await multiplierForOrg(orgId);
    const customer = upstream * (multiplierBps / 10_000);

    const hash = dedupeHash(row);

    // Attribute the request to the key and the member that made it.
    // The gateway's token hash is the join key — the identifier that
    // survived the display-mask/token confusions (lib/litellm/client.ts).
    // Both are nullable on purpose: a spend row whose key was deleted
    // keeps its money but loses its attribution, and an org-scoped key
    // (no per-member pin) has no member to name. Two indexed lookups on
    // a 15-minute window are cheaper than the backfill this replaces.
    let apiKeyId: string | null = null;
    if (row.api_key) {
      const found = await db.execute(sql`
        SELECT id FROM api_keys
         WHERE organization_id = ${orgId}::uuid
           AND litellm_key_hash = ${row.api_key}
         LIMIT 1
      `);
      apiKeyId = (found as unknown as { id: string }[])[0]?.id ?? null;
    }

    let memberUserId: string | null = null;
    if (row.user_id) {
      const found = await db.execute(sql`
        SELECT u.id
          FROM organization_members m
          JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ${orgId}::uuid
           AND m.litellm_user_id = ${row.user_id}
         LIMIT 1
      `);
      memberUserId = (found as unknown as { id: string }[])[0]?.id ?? null;
    }

    // ── Prompt counting: ONE inference request = ONE prompt. ──────────
    //
    // A chat client resends its whole conversation on every turn, so the
    // request body holds one user message per turn so far. The old code
    // counted messages in the body and diffed against the previous request
    // per key in process memory — which over-counted on restart, misjudged
    // tool-result continuations, and needed row ordering to be right.
    //
    // The exact rule is simpler: every message a user sends triggers
    // exactly one inference request (tool calls the model makes are
    // continuations *within* that request, not new prompts). So the
    // prompt count of a row is 1 when its route is inference, 0 otherwise.
    // No parsing, no per-key memory, no restart skew — idempotent by
    // construction, since the value depends only on the row itself.
    // ── Prompt counting: ONE successful inference request = ONE prompt. ──
    //
    // 1 user message → 1 gateway request → prompt_count = 1. Tool calls the
    // model makes are continuations *within* that request, not new prompts.
    // Failures (429, rejected `__not_allowed__`, NULL status) are 0 — only
    // a 200 counts. Idempotent: depends only on this row, no per-key memory.
    const statusCode = statusCodeForRow(row);
    const promptCount = promptCountForRow(route, statusCode);

    // ── Latency. ──────────────────────────────────────────────────────
    //
    // `LiteLLM_SpendLogs.request_duration_ms` is NOT NULL and carried by
    // every row (verified live), so it is the only latency signal the
    // ledger can hold. It was written as a literal NULL here for as long as
    // this insert existed, so every p50/p95 built on `usage_records` read
    // an empty column.
    //
    // A non-finite or negative value is NULL, never 0: 0 ms is a
    // measurement, and a missing one must not enter an average as "instant".
    const latencyMs =
      typeof row.request_duration_ms === 'number' &&
      Number.isFinite(row.request_duration_ms) &&
      row.request_duration_ms >= 0
        ? Math.round(row.request_duration_ms)
        : null;

    const inserted = await db.execute(sql`
      INSERT INTO usage_records (
        organization_id, api_key_id, member_user_id, occurred_at, billing_period,
        model, route, upstream_key_hash,
        input_tokens, fresh_input_tokens, output_tokens,
        cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens,
        latency_ms, status_code,
        cost_upstream_usd, cost_customer_usd,
        price_table_version, prompt_count, dedupe_hash, gateway_request_id
      )
      SELECT
        ${orgId}::uuid,
        ${apiKeyId}::uuid,
        ${memberUserId}::uuid,
        ${row.startTime ?? now.toISOString()}::timestamptz,
        date_trunc('month', ${row.startTime ?? now.toISOString()}::timestamptz)::date,
        ${alias},
        ${route},
        ${row.api_key ?? null},
        ${u.inputTokens}, ${u.freshInput}, ${u.outputTokens},
        ${u.cacheWrite5m}, ${u.cacheWrite1h}, ${u.cacheRead},
        ${latencyMs},
        ${statusCode},
        ${upstream}, ${customer},
        ${PRICE_VERSION},
        ${promptCount},
        ${hash},
        ${row.litellm_call_id ?? null}
      ON CONFLICT (dedupe_hash) DO NOTHING
      RETURNING id
    `);

    // `db.execute` with postgres-js returns the RowList directly (it is
    // already the array of rows); the `.rows` accessor belongs to the
    // node-postgres driver. Count the returned rows to decide whether the
    // INSERT was a fresh insert or a dedupe hit.
    if (inserted.length > 0) result.inserted++;
    else result.skippedDuplicates++;

    // ── Give the chat bubble its own numbers.
    //
    // A chat turn writes its message row BEFORE the model answers (an
    // interrupted turn must still be visible, lib/chat/service.ts), so the
    // tokens and cost do not exist yet at insert time. This is where they
    // arrive: the spend row carries the gateway request id the stream
    // sniffed from the response headers, so the join is exact rather than
    // "the latest message by this user".
    //
    // Only on a fresh insert: a dedupe hit means we already did this, and
    // re-running it would be a write per poll for no change. `cost_usd` is
    // the CUSTOMER cost, because that is what the owner of the bubble is
    // charged. Best-effort — a chat that fails to get its cost backfilled
    // must never fail the ledger write that just succeeded.
    //
    // THE JOIN KEY IS `litellm_call_id`, NOT `request_id`. The chat route
    // stores the `x-litellm-call-id` response header in
    // `messages.gateway_request_id`; `request_id` in the spend log is the
    // UPSTREAM provider's id (`chatcmpl-…`), a different value entirely.
    // Joining on it matched nothing, so every chat turn kept cost_usd NULL
    // while the spend sat in the ledger under a key no row referenced.
    const joinId = row.litellm_call_id ?? null;
    if (inserted.length > 0 && joinId) {
      await db.execute(sql`
        UPDATE messages
           SET input_tokens  = ${u.inputTokens},
               output_tokens = ${u.outputTokens},
               cost_usd      = ${customer}
         WHERE gateway_request_id = ${joinId}
           AND cost_usd IS NULL
      `).catch((e: unknown) => {
        result.chatBackfillFailed++;
        log.warn('usage: could not backfill chat message cost', {
          callId: joinId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
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
       AND s.status IN ('active','past_due','paused')
     LIMIT 1
  `) as unknown as { rate_multiplier_bps: number }[];

  return { multiplierBps: row?.rate_multiplier_bps ?? 10_000 };
}

/**
 * Rebuild `usage_periods` from the ledger.
 *
 * Always derived — never incrementally incremented. An increment that runs
 * twice silently doubles a customer's bill, and you cannot tell from the
 * dashboard which number is wrong.
 *
 * Rebuilt, never incremented: an increment run twice silently doubles a
 * bill.
 *
 * `input_tokens` HERE HOLDS FRESH INPUT (0028), not the provider's raw
 * `prompt_tokens`. That is deliberate: this table exists to accelerate
 * charts, and the chart it accelerates is the usage view, whose blended
 * total must match the quota wall. Storing raw inclusive input would make
 * `input_tokens + cache_read_tokens` — the obvious chart sum — inflate by
 * the cached portion again, in a second place. The raw value stays
 * available in `usage_records` for audit.
 *
 * Orgs with usage but NO live subscription are skipped. Their spend is
 * real and stays in `usage_records` — the source of truth — but a
 * rollup row is an attribution of that spend to a PLAN, and there is no
 * plan to attribute it to (a canceled account, or one that never
 * subscribed). Without the guard the subselects below return NULL and
 * the NOT NULL plan_id aborts the whole pass — one stale org would stop
 * every dashboard from updating.
 */
export async function rollupUsage(): Promise<void> {
  await db.execute(sql`
    INSERT INTO usage_periods (
      organization_id, billing_period, plan_id, rate_multiplier_bps,
      requests, prompts, input_tokens, output_tokens, cache_read_tokens,
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
      COALESCE(SUM(u.prompt_count), 0),
      SUM(COALESCE(u.fresh_input_tokens, u.input_tokens - LEAST(u.cache_read_tokens, u.input_tokens))),
      SUM(u.output_tokens),
      SUM(u.cache_read_tokens),
      SUM(u.cost_upstream_usd),
      SUM(u.cost_customer_usd),
      now()
    FROM usage_records u
    WHERE EXISTS (
      SELECT 1 FROM subscriptions s
       WHERE s.organization_id = u.organization_id
         AND s.status IN ('active','past_due','paused')
    )
    GROUP BY u.organization_id, u.billing_period
    ON CONFLICT (organization_id, billing_period) DO UPDATE SET
      requests            = EXCLUDED.requests,
      prompts             = EXCLUDED.prompts,
      input_tokens        = EXCLUDED.input_tokens,
      output_tokens       = EXCLUDED.output_tokens,
      cache_read_tokens   = EXCLUDED.cache_read_tokens,
      cost_upstream_usd   = EXCLUDED.cost_upstream_usd,
      cost_customer_usd   = EXCLUDED.cost_customer_usd,
      updated_at          = now()
  `);
}