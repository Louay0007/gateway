/**
 * POST /api/trial/redeem — redeem a free trial code.
 *
 * Requires an authenticated user with an active organization.
 * Body: { code: string }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { currentUser, requireActiveOrg } from '@/lib/auth/authorize';
import { redeemTrialCode } from '@/lib/trial/service';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // The domain id, not the session id: the session carries the AUTH
  // identity (auth_users.id) while trial_redemptions.user_id references
  // the domain mirror (users.id) — the two are different UUIDs bridged by
  // email (see create-user.ts). Passing the session id here violated the
  // FK on every redemption; requireActiveOrg's userId is the domain id.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const code = body.code;
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: 'validation', message: 'A trial code is required.' }, { status: 400 });
  }

  // Resolve the user's active organization
  let orgId: string;
  let domainUserId: string;
  try {
    const resolved = await requireActiveOrg();
    orgId = resolved.orgId;
    domainUserId = resolved.userId;
  } catch {
    return NextResponse.json(
      { error: 'no_org', message: 'You must have an organization to redeem a trial code.' },
      { status: 403 },
    );
  }

  const result = await redeemTrialCode(domainUserId, orgId, code);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      invalid_code: 404,
      code_expired: 410,
      code_not_yet_valid: 400,
      max_redemptions_reached: 409,
      already_redeemed: 409,
      active_paid_subscription: 409,
      org_not_found: 403,
      trial_plan_missing: 500,
      sync_failed: 500,
    };
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: statusMap[result.error!] ?? 400 },
    );
  }

  return NextResponse.json({ ok: true, message: result.message, expiresAt: result.expiresAt });
}