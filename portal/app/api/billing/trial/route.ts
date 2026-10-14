/**
 * POST /api/billing/trial — start the org's free trial (0009).
 *
 * Body: { planCode }.
 *
 * Owner-only and email-verified, exactly like checkout: a trial grants
 * the plan's full limits for free, so it is a billing commitment.
 * `startTrial` enforces one-trial-per-org (audit-backed) and refuses a
 * suspended account; this route only shapes the request and the reply.
 *
 * No checkoutUrl is returned — a trial has no payment. The client simply
 * reloads the dashboard, which now reads `trialing`.
 */

import { z } from 'zod';
import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { requireVerifiedEmail } from '@/lib/auth/verify-email';
import { startTrial } from '@/lib/billing';
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
    await requireVerifiedEmail(ctx.userId);
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can start a trial.');
    }

    const result = await startTrial(ctx.orgId, parsed.data.planCode, ctx.userId);
    return Response.json({ trialEnd: result.trialEnd, plan: result.plan });
  } catch (e) {
    return errorResponse(e);
  }
}
