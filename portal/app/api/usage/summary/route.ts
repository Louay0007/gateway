/**
 * GET /api/usage/summary — a real, dense, bucketed series (Step 8).
 *
 * The Usage page's chart used to bucket ONE PAGE of rows (25) client-side
 * and label the min/max of that page a "date range". It could never show
 * more than ~25 days, and a quiet day vanished instead of plotting as a
 * zero — a trend line that was, by omission, wrong.
 *
 * This endpoint replaces that arithmetic with a database fact: bucket by
 * day or hour over an explicit window, with every bucket in the window
 * present (generate_series zero-fills the gaps). Same `from`/`to`/`model`/
 * `apiKeyId` filters as `/api/usage`, so the chart and the table describe
 * the same rows.
 *
 * `range_too_large` is a hard 400 rather than a silently truncated series.
 * An hour-bucketed year is 8760 points; cutting it off would reproduce the
 * very lie this endpoint exists to end.
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { usageHistorySeries } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = z.string().uuid();

const querySchema = z.object({
  bucket: z.enum(['day', 'hour']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  model: z.string().trim().min(1).max(64).optional(),
  apiKeyId: UUID.optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    bucket: url.searchParams.get('bucket') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    apiKeyId: url.searchParams.get('apiKeyId') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid query parameters.',
    );
  }

  try {
    const ctx = await requireActiveOrg();
    const result = await usageHistorySeries(ctx.orgId, parsed.data);
    if ('error' in result) {
      return jsonError(
        'validation',
        'That range is too large for this bucket. Use bucket=day or a shorter window.',
      );
    }
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
