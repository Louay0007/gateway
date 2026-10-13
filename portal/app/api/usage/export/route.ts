/**
 * GET /api/usage/export — the ledger as CSV.
 *
 * The Usage page has carried a disabled "CSV" button since it was built,
 * because `/api/usage` is JSON and `pageSize` is capped at 100. This is the
 * stream it was waiting for.
 *
 * STREAMED, not buffered. A year of traffic on a busy key is tens of
 * thousands of rows; building the whole string first would hold it all in
 * the Next.js process and then in the browser's download buffer. Rows are
 * yielded as they are read, so memory is bounded by the page size.
 *
 * THE SAME FILTERS AS /api/usage, deliberately. An export that silently
 * ignores the range and model the table is showing produces a file that
 * disagrees with the screen, which is the worst kind of export bug.
 *
 * FORMULA INJECTION. Every cell passes through `csvCell`, which prefixes a
 * leading `=`, `+`, `-` or `@` with a single quote. A model alias or an
 * auth-adjacent string is attacker-influencable text, and a spreadsheet
 * that evaluates `=HYPERLINK(...)` on open is executing our export. This is
 * the standard mitigation and it costs nothing.
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { usageHistory, type UsageHistoryQuery } from '@/lib/billing';
import { csvCell, csvRow } from '@/lib/csv';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = z.string().uuid();

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  model: z.string().trim().min(1).max(64).optional(),
  apiKeyId: UUID.optional(),
});

/** Rows per database round trip while streaming. */
const PAGE = 500;
/** Hard ceiling, so a pathological request cannot stream forever. */
const MAX_ROWS = 100_000;

const COLUMNS = [
  'occurred_at',
  'billing_period',
  'model',
  'route',
  'key',
  'input_tokens',
  'output_tokens',
  'cache_write_5m_tokens',
  'cache_write_1h_tokens',
  'cache_read_tokens',
  'status_code',
  'cost_upstream_usd',
  'cost_customer_usd',
  'latency_ms',
] as const;


function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    apiKeyId: url.searchParams.get('apiKeyId') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid query parameters.');
  }

  let ctx: Awaited<ReturnType<typeof requireActiveOrg>>;
  try {
    ctx = await requireActiveOrg();
  } catch (e) {
    return errorResponse(e);
  }

  const filters: UsageHistoryQuery = { ...parsed.data };
  const stamp = new Date().toISOString().slice(0, 10);

  // Counted BEFORE the stream opens, so `Content-Length`-adjacent facts
  // (`X-Row-Count`) and the truncation check are known up front. A count
  // inside the stream would be unavailable to the response headers.
  const first = await usageHistory(ctx.orgId, { ...filters, page: 1, pageSize: 1 });
  const total = first.total;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (s: string) => controller.enqueue(enc.encode(s));

      // BOM: without it Excel opens UTF-8 CSV in the system codepage and
      // mangles every non-ASCII plan or key name.
      send('\uFEFF');
      send(csvRow(COLUMNS) + '\r\n');

      let page = 1;
      let written = 0;

      try {
        while (written < total && written < MAX_ROWS) {
          const batch = await usageHistory(ctx.orgId, {
            ...filters,
            page,
            pageSize: PAGE,
          });
          if (batch.rows.length === 0) break;

          for (const r of batch.rows) {
            send(
              csvRow([
                r.occurredAt,
                r.billingPeriod,
                r.model,
                r.route,
                r.keyName,
                r.inputTokens,
                r.outputTokens,
                r.cacheWrite5mTokens,
                r.cacheWrite1hTokens,
                r.cacheReadTokens,
                r.statusCode,
                r.costUpstreamUsd.toFixed(8),
                r.costCustomerUsd.toFixed(8),
                r.latencyMs,
              ]) + '\r\n',
            );
            written++;
          }

          page++;
          if (batch.rows.length < PAGE) break;
        }

        // A trailing comment row, so a truncated export cannot be mistaken
        // for a complete one.
        if (written < total) {
          send(
            `# truncated at ${written} of ${total} rows (export limit ${MAX_ROWS})\r\n`,
          );
        }
      } catch (e) {
        // The status line is long gone — the response committed as 200
        // when the stream opened. A comment row is the only signal left,
        // so make it unmistakable.
        const msg = e instanceof Error ? e.message : String(e);
        log.error('usage export: stream failed', {
          organizationId: ctx.orgId,
          written,
          total,
          error: msg,
        });
        send(`# ERROR: export failed after ${written} of ${total} rows — ${msg}\r\n`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="usage-${isoDay(new Date())}.csv"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(total),
      // Never sniff a download into something executable.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}