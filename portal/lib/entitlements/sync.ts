/**
 * Entitlement sync — plan × subscription status → LiteLLM enforcement.
 *
 * This is the single writer of the `entitlements` table and the only thing
 * that pushes limits to the gateway. PLATFORM.md §5: "One function, one
 * writer, idempotent."
 *
 * Two properties are load-bearing and are the reason this file is shaped
 * the way it is:
 *
 *   1. CACHING BEFORE PUSHING. The intended state is written to
 *      `entitlements` BEFORE the gateway is touched, and marked `synced`
 *      only after every push succeeds. A dashboard must never claim a
 *      customer is starved while their key still works.
 *
 *   2. 0 IS NOT "DENY". LiteLLM's limiter reads a limit of 0 as
 *      "unlimited". Cutting access therefore means 0.000001. Writing 0
 *      grants unlimited access to a customer we meant to suspend — the
 *      most expensive possible bug in this system.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { entitlements, organizations, plans, subscriptions, auditLog } from '@/db/schema';
import { updateTeamBudget, updateKeyLimits, listTeamKeys } from '@/lib/litellm/client';
import {
  CUT_BUDGET,
  effectForStatus,
  resolveBudgetUsd,
  type Effect,
} from '@/lib/entitlements/policy';
import { log } from '@/lib/log';

// The rules (CUT_BUDGET, STATUS_EFFECT, resolveBudgetUsd) live in
// ./policy — pure, importable without a database, unit-tested there.
// Re-exported so existing callers of sync.ts keep working.
export { CUT_BUDGET, STATUS_EFFECT, resolveBudgetUsd } from '@/lib/entitlements/policy';
export type { Effect } from '@/lib/entitlements/policy';

export interface SyncResult {
  ok: boolean;
  error?: string;
  effect: Effect;
  budgetUsd: number;
  keysSynced: number;
}

/** The live subscription, per the partial unique index `subscriptions_one_live_idx`. */
async function getLiveSubscription(orgId: string) {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        eq(subscriptions.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolve the live subscription including trialing/paused.
 *
 * `subscriptions_one_live_idx` covers ('trialing','active','past_due',
 * 'paused'); this mirrors that predicate exactly. Kept as a separate
 * function from getLiveSubscription so the index definition and the query
 * that depends on it stay in one place.
 */
async function resolveLive(orgId: string) {
  const rows = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import('drizzle-orm')).sql`
      SELECT s.id, s.status, p.id AS plan_id, p.code AS plan_code,
             p.included_spend_cents, p.hard_cap_cents, p.rpm_limit,
             p.tpm_limit, p.max_concurrent_requests, p.models,
             p.max_keys, p.max_seats, p.rate_multiplier_bps, p.trial_days
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
       WHERE s.organization_id = ${orgId}
         AND s.status IN ('trialing','active','past_due','paused')
       LIMIT 1
    `,
  ) as unknown as {
    id: string; status: string; plan_id: string; plan_code: string;
    included_spend_cents: number; hard_cap_cents: number | null;
    rpm_limit: number | null; tpm_limit: number | null;
    max_concurrent_requests: number | null; models: string[];
    max_keys: number; max_seats: number; rate_multiplier_bps: number;
    trial_days: number;
  }[];
  return rows[0] ?? null;
}

export interface EntitlementSpec {
  effect: Effect;
  planCode: string;
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null;
  models: string[];
  maxKeys: number;
  maxSeats: number;
  maxBudgetUsd: number;
  budgetDuration: string;
}

/**
 * Push an org's entitlement to the gateway.
 *
 * Idempotent: calling it repeatedly with the same inputs converges on the
 * same state, which is what makes the 1-hour reconcile job safe and what
 * makes a webhook replay harmless.
 */
export async function syncOrganizationEntitlements(
  organizationId: string,
  reason: string,
): Promise<SyncResult> {
  const live = await resolveLive(organizationId);
  if (!live) {
    // No live subscription is itself a cut condition — an org with only a
    // canceled subscription must not keep access.
    await forceCut(organizationId, reason, 'no live subscription');
    return { ok: false, error: 'no live subscription', effect: 'cut', budgetUsd: CUT_BUDGET, keysSynced: 0 };
  }

  const effect = effectForStatus(live.status);
  const budgetUsd = resolveBudgetUsd(
    {
      includedSpendCents: live.included_spend_cents,
      hardCapCents: live.hard_cap_cents,
    },
    effect,
  );

  const spec: EntitlementSpec = {
    effect,
    planCode: live.plan_code,
    rpm: effect === 'cut' ? null : live.rpm_limit,
    tpm: effect === 'cut' ? null : live.tpm_limit,
    concurrency: effect === 'cut' ? null : live.max_concurrent_requests,
    models: effect === 'cut' ? [] : live.models,
    maxKeys: live.max_keys,
    maxSeats: live.max_seats,
    maxBudgetUsd: budgetUsd,
    budgetDuration: '30d',
  };

  // ── 1. Cache the intended state FIRST, so the dashboard is correct
  //       even if the gateway is unreachable.
  await db.insert(entitlements)
    .values({
      organizationId,
      planId: live.plan_id,
      planCode: live.plan_code,
      effective: spec as unknown as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
    })
    .onConflictDoUpdate({
      target: entitlements.organizationId,
      set: {
        planId: live.plan_id,
        planCode: live.plan_code,
        effective: spec as unknown as Record<string, unknown>,
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  const failures: string[] = [];
  let keysSynced = 0;

  // ── 2. Push down. Every key individually — a partial failure must not
  //       leave one key on an old plan while its siblings moved.
  if (org?.litellmTeamId) {
    try {
      await updateTeamBudget(org.litellmTeamId, {
        maxBudgetUsd: budgetUsd,
        budgetDuration: spec.budgetDuration,
      });
    } catch (e) {
      failures.push(`team ${org.litellmTeamId}: ${String(e)}`);
    }

    const keys = await listTeamKeys(org.litellmTeamId);
    for (const k of keys) {
      try {
        await updateKeyLimits(k.key_name, {
          models: effect === 'cut' ? [] : spec.models,
          maxBudget: budgetUsd,
          budgetDuration: spec.budgetDuration,
          rpmLimit: spec.rpm,
          tpmLimit: spec.tpm,
          maxParallelRequests: spec.concurrency,
        });
        keysSynced++;
      } catch (e) {
        failures.push(`key ${k.key_name}: ${String(e)}`);
      }
    }
  }

  // ── 3. Record the outcome. `synced` only when everything landed.
  if (failures.length) {
    const message = failures.join('; ');
    await db.update(entitlements)
      .set({ status: 'failed', lastError: message })
      .where(eq(entitlements.organizationId, organizationId));

    log.error('entitlement sync failed', { organizationId, reason, error: message });
    return { ok: false, error: message, effect, budgetUsd, keysSynced };
  }

  await db.update(entitlements)
    .set({ status: 'synced', syncedAt: new Date(), lastError: null })
    .where(eq(entitlements.organizationId, organizationId));

  await db.insert(auditLog).values({
    actorType: 'system',
    action: 'entitlements.synced',
    organizationId,
    after: { effect, reason, plan: live.plan_code, budgetUsd, keysSynced },
  });

  return { ok: true, effect, budgetUsd, keysSynced };
}

/**
 * Cut access for an org that has no resolvable plan.
 *
 * Separate from the main path because it must work even when the
 * subscription rows are missing or inconsistent — an org suspended by
 * staff, for example.
 */
async function forceCut(organizationId: string, reason: string, error: string): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!org?.litellmTeamId) return;

  try {
    await updateTeamBudget(org.litellmTeamId, {
      maxBudgetUsd: CUT_BUDGET,
      budgetDuration: '30d',
    });
  } catch (e) {
    log.error('force cut failed', { organizationId, error: String(e) });
  }

  await db.insert(auditLog).values({
    actorType: 'system',
    action: 'entitlements.cut',
    organizationId,
    after: { reason, error, budgetUsd: CUT_BUDGET },
  });
}