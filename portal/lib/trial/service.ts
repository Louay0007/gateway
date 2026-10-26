/**
 * Free trial redemption service (0017).
 *
 * Validates a promo code, creates/updates the org's subscription to the
 * hidden `trial` plan with status `trialing`, records the redemption,
 * and syncs entitlements to LiteLLM so the key limits take effect
 * immediately.
 */

import { eq, sql, and, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import {
  trialCodes,
  trialRedemptions,
  organizations,
  subscriptions,
  plans,
  users,
} from '@/db/schema';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

export type RedeemError =
  | 'invalid_code'
  | 'code_expired'
  | 'code_not_yet_valid'
  | 'max_redemptions_reached'
  | 'already_redeemed'
  | 'active_paid_subscription'
  | 'org_not_found'
  | 'trial_plan_missing'
  | 'sync_failed';

export interface RedeemResult {
  ok: boolean;
  error?: RedeemError;
  message?: string;
  expiresAt?: string;
}

export async function redeemTrialCode(
  userId: string,
  orgId: string,
  code: string,
): Promise<RedeemResult> {
  const normalized = code.trim().toUpperCase();

  // 1. Validate the code exists and is within its validity window
  const [tc] = await db
    .select()
    .from(trialCodes)
    .where(eq(trialCodes.code, normalized))
    .limit(1);

  if (!tc) return { ok: false, error: 'invalid_code', message: 'Invalid trial code.' };
  if (!tc.active) return { ok: false, error: 'invalid_code', message: 'This code is no longer active.' };

  const now = new Date();
  if (now < tc.validFrom) return { ok: false, error: 'code_not_yet_valid', message: 'This code is not yet valid.' };
  if (now > tc.validUntil) return { ok: false, error: 'code_expired', message: 'This code has expired.' };

  // 2. Check max redemptions (0 = unlimited)
  if (tc.maxRedemptions > 0 && tc.redeemedCount >= tc.maxRedemptions) {
    return { ok: false, error: 'max_redemptions_reached', message: 'All redemptions for this code have been claimed.' };
  }

  // 3. Check org hasn't already redeemed this code
  const [existing] = await db
    .select({ id: trialRedemptions.id })
    .from(trialRedemptions)
    .where(
      and(
        eq(trialRedemptions.organizationId, orgId),
        eq(trialRedemptions.trialCodeId, tc.id),
      ),
    )
    .limit(1);

  if (existing) {
    return { ok: false, error: 'already_redeemed', message: 'Your organization has already redeemed this code.' };
  }

  // 4. Check org doesn't have an active paid subscription
  const [activeSub] = await db
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        sql`${subscriptions.status} IN ('active', 'past_due')`,
      ),
    )
    .limit(1);

  if (activeSub) {
    return {
      ok: false,
      error: 'active_paid_subscription',
      message: 'You already have an active subscription. Trials are for new users only.',
    };
  }

  // 5. Find the hidden trial plan
  const [trialPlan] = await db
    .select()
    .from(plans)
    .where(eq(plans.code, 'trial'))
    .limit(1);

  if (!trialPlan) {
    log.error('trial plan missing from database');
    return { ok: false, error: 'trial_plan_missing', message: 'Trial configuration error. Contact support.' };
  }

  // 6. Compute expiry: min(redeem_time + trial_days, code.expires_at)
  const redeemExpiry = new Date(now.getTime() + tc.trialDays * 24 * 60 * 60 * 1000);
  const expiresAt = redeemExpiry < tc.expiresAt ? redeemExpiry : tc.expiresAt;

  // 7. Create or update the subscription in a transaction
  let subId: string;

  try {
    const result = await db.transaction(async (tx) => {
      // Check for existing subscription row (the system keeps exactly one per org)
      const [existingSub] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, orgId))
        .limit(1);

      let subscriptionId: string;

      if (existingSub) {
        // Update existing subscription to trial
        await tx
          .update(subscriptions)
          .set({
            planId: trialPlan.id,
            status: 'trialing',
            trialEnd: expiresAt,
            currentPeriodStart: now,
            currentPeriodEnd: expiresAt,
            cancelAtPeriodEnd: false,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, existingSub.id));
        subscriptionId = existingSub.id;
      } else {
        // Create new subscription
        const [inserted] = await tx
          .insert(subscriptions)
          .values({
            organizationId: orgId,
            planId: trialPlan.id,
            status: 'trialing',
            trialEnd: expiresAt,
            currentPeriodStart: now,
            currentPeriodEnd: expiresAt,
            cancelAtPeriodEnd: false,
          })
          .returning({ id: subscriptions.id });
        subscriptionId = inserted!.id;
      }

      // Record the redemption
      await tx.insert(trialRedemptions).values({
        trialCodeId: tc.id,
        organizationId: orgId,
        userId,
        subscriptionId,
        expiresAt,
      });

      // Increment redeemed_count atomically
      await tx
        .update(trialCodes)
        .set({ redeemedCount: sql`${trialCodes.redeemedCount} + 1` })
        .where(eq(trialCodes.id, tc.id));

      return { subscriptionId };
    });

    subId = result.subscriptionId;
  } catch (err) {
    log.error('trial redemption transaction failed', { error: String(err), orgId, code: normalized });
    return { ok: false, error: 'sync_failed', message: 'Failed to activate trial. Please try again.' };
  }

  // 8. Sync entitlements to LiteLLM so limits take effect immediately
  try {
    const sync = await syncOrganizationEntitlements(orgId, 'trial_redeemed');
    if (!sync.ok) {
      log.warn('trial entitlement sync returned error', { orgId, error: sync.error });
      // Don't fail the redemption — the retry job will pick it up
    }
  } catch (err) {
    log.warn('trial entitlement sync threw', { orgId, error: String(err) });
  }

  log.info('trial redeemed', { orgId, userId, code: normalized, expiresAt: expiresAt.toISOString() });

  return {
    ok: true,
    message: `Free trial activated! Your trial expires on ${expiresAt.toLocaleDateString('en-TN', { year: 'numeric', month: 'long', day: 'numeric' })}. The free trial campaign ends 31 October.`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Get the current trial status for an org, if any.
 */
export async function getTrialStatus(orgId: string): Promise<{
  active: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  /** Blended-token budgets for the trial window. Migration 0023. */
  tokenLimits: Record<string, number>;
  models: string[];
} | null> {
  const [sub] = await db
    .select({
      status: subscriptions.status,
      trialEnd: subscriptions.trialEnd,
      models: plans.models,
      tokenLimits: plans.tokenLimits,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        eq(plans.code, 'trial'),
        eq(subscriptions.status, 'trialing'),
      ),
    )
    .limit(1);

  if (!sub || !sub.trialEnd) return null;

  const now = new Date();
  if (now > sub.trialEnd) return null;

  const msRemaining = sub.trialEnd.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  const tokenLimits: Record<string, number> = {};
  if (sub.tokenLimits && typeof sub.tokenLimits === 'object') {
    for (const [k, v] of Object.entries(sub.tokenLimits as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) tokenLimits[k] = v;
    }
  }

  return {
    active: true,
    expiresAt: sub.trialEnd.toISOString(),
    daysRemaining,
    tokenLimits,
    models: sub.models ?? [],
  };
}