/**
 * POST /api/subscription/change-plan — upgrade or downgrade.
 *
 * Owner only. The gateway limits change immediately through the
 * entitlement sync; the provider-side price swap lands on renewal
 * (recorded in lib/billing/d17.ts until the PSP is wired).
 */

import { z } from 'zod';
import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { changePlan } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  planCode: z.string().trim().min(1).max(40),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const ctx = await requireActiveOrg();
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can change the plan.');
    }

    const result = await changePlan(ctx.orgId, parsed.data.planCode, ctx.userId);
    return Response.json({ plan: result.plan, state: 'active' });
  } catch (e) {
    return errorResponse(e);
  }
}
