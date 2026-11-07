/**
 * POST /api/trial/redeem — redeem a free trial code.
 *
 * Requires an authenticated user with an active organization.
 * Body: { code: string }
 *
 * Errors go through the shared envelope (`{ error: { code, message } }`)
 * like every other route. A dead code is `gone`/410: the campaign ended,
 * retrying will not help, and the UI says so.
 */
import { z } from 'zod';
import { currentUser, requireActiveOrg } from '@/lib/auth/authorize';
import { jsonError } from '@/lib/api/errors';
import { redeemTrialCode, type RedeemError } from '@/lib/trial/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ code: z.string().trim().min(1).max(64) });

const ERROR_MAP: Record<RedeemError, 'not_found' | 'gone' | 'validation' | 'conflict' | 'forbidden' | 'internal'> = {
  invalid_code: 'not_found',
  code_expired: 'gone',
  code_not_yet_valid: 'validation',
  max_redemptions_reached: 'conflict',
  already_redeemed: 'conflict',
  active_paid_subscription: 'conflict',
  org_not_found: 'forbidden',
  trial_plan_missing: 'internal',
  sync_failed: 'internal',
};

export async function POST(request: Request): Promise<Response> {
  // The domain id, not the session id: the session carries the AUTH
  // identity (auth_users.id) while trial_redemptions.user_id references
  // the domain mirror (users.id) — the two are different UUIDs bridged by
  // email (see create-user.ts). Passing the session id here violated the
  // FK on every redemption; requireActiveOrg's userId is the domain id.
  const user = await currentUser();
  if (!user) return jsonError('unauthorized', 'Sign in to redeem a code.');

  let ctx: { orgId: string; userId: string };
  try {
    ctx = await requireActiveOrg();
  } catch {
    return jsonError('forbidden', 'You must have an organization to redeem a trial code.');
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return jsonError('validation', 'A trial code is required.');
  }

  const result = await redeemTrialCode(ctx.userId, ctx.orgId, parsed.data.code);
  if (!result.ok) {
    return jsonError(
      ERROR_MAP[result.error ?? 'invalid_code'],
      result.message ?? 'That code could not be redeemed.',
    );
  }

  return Response.json({ ok: true, message: result.message, expiresAt: result.expiresAt });
}
