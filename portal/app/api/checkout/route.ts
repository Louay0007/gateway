/**
 * POST /api/checkout — start a subscription (IMPLEMENTATION.md §3.1).
 *
 * Body: { planCode, method? }.
 *
 * `method` is the customer's payment choice: 'd17' selects the La Poste
 * flow (instruction page + manual verification), anything else uses the
 * provider configured for the deployment. The org comes from the
 * session, never the body — a checkout that trusted the body's org id
 * is a free upgrade for anyone who can count (PLATFORM.md §10.1).
 *
 * Returns the provider's payment URL. For D17 that is our own
 * instruction page: the transfer itself happens inside the D17 app.
 */

import { z } from 'zod';
import { requireActiveOrg, roleAtLeast } from '@/lib/auth/authorize';
import { beginCheckout } from '@/lib/billing';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  planCode: z.string().trim().min(1).max(40),
  method: z.enum(['d17']).optional(),
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
    // Owner only: this is a billing commitment.
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can subscribe.');
    }

    const { intent } = await beginCheckout(
      ctx.orgId,
      parsed.data.planCode,
      ctx.userId,
      parsed.data.method ?? null,
    );
    return Response.json({
      checkoutUrl: intent.checkoutUrl,
      subscriptionId: intent.subscriptionId,
      provider: intent.providerReference,
      method: parsed.data.method ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
