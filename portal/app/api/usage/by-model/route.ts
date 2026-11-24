/**
 * GET /api/usage/by-model — true per-model aggregates.
 *
 * The Usage page's "By model" tab used to sum the 25 rows on screen and
 * admit it in a hint. This route answers the question the tab asks: over
 * the same window and filters as the table, which model consumed the pool.
 *
 * Same `from`/`to`/`model`/`apiKeyId` contract as `/api/usage` and
 * `/api/usage/summary`, so the three describe one dataset rather than
 * three approximations of it.
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { usageByModel } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  model: z.string().trim().min(1).max(64).optional(),
  apiKeyId: z.string().uuid().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
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
    const result = await usageByModel(ctx.orgId, parsed.data);
    return Response.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
