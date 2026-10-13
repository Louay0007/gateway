/**
 * GET /api/usage — the account's ledger, filtered and paginated (C-03).
 *
 * The org comes from the session; every filter is optional.
 *
 * `model` and `apiKeyId` exist because the Usage page filters with real
 * controls. Doing it in SQL rather than in the browser is what keeps the
 * page honest: the `total` reflects the filter, so "412 requests match"
 * is a fact about the database and not about the 50 rows that happened to
 * arrive.
 *
 * `pageSize` is capped at 100 by the service. CSV export (C-04) is
 * deferred past MVP — this endpoint's shape is what it will stream from
 * when it lands, which is why `rows` is already a projection
 * (`UsageRowView`) rather than a raw table row.
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { usageHistory } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = z.string().uuid();

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  model: z.string().trim().min(1).max(64).optional(),
  // Optional, but a malformed one is a hard 400 rather than a silent
  // "no results": a client that sent a broken key id has a bug, and
  // telling it "0 requests" would hide that bug behind an empty table.
  apiKeyId: UUID.optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    apiKeyId: url.searchParams.get('apiKeyId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid query parameters.',
    );
  }

  try {
    const ctx = await requireActiveOrg();
    const result = await usageHistory(ctx.orgId, parsed.data);
    return Response.json({
      rows: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      // Aggregates over the same filter as `rows`, so the summary cards
      // and the table can never disagree.
      totals: result.totals,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
