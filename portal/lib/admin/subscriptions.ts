/**
 * Manual plan grants — put an org on a catalog plan without a provider.
 *
 * WHY THIS IS NOT `changePlan()`. `lib/billing/service.ts` owns customer-
 * initiated plan changes, and it requires a live subscription to change
 * (`active | past_due | paused`). That is the wrong precondition for the
 * case this module exists for, which is the opposite of a live one: a
 * comped account with no subscription row at all, an `incomplete` D17
 * claim that has to be given service now, or a lapsed org an operator has
 * decided to make whole. `applyCallback()` is the other write path and it
 * needs a provider event id that a manual grant does not have.
 *
 * So a grant is its own write path — but it ends in exactly the call
 * every other transition ends in, `syncOrganizationEntitlements`. That is
 * the non-negotiable part: writing `subscriptions` alone changes what the
 * dashboard says and nothing about what the gateway allows, and an
 * "upgraded" org that still gets 403s is worse than no button at all.
 *
 * INVARIANTS
 *
 *   ONE ROW. `subscriptions_one_live_idx` is unique on
 *   `(organization_id) WHERE status IN ('trialing','active','past_due',
 *   'paused')`, so a grant must MUTATE the org's row rather than insert a
 *   second live one. Which row is resolved with the SAME ordering
 *   `sync.ts:resolveSubscription` uses — live first, then most recently
 *   updated — because updating one row while the sync reads another is
 *   precisely how an org ends up "on Pro" in the console and on Trial in
 *   LiteLLM. `FOR UPDATE` holds that choice for the duration of the write.
 *
 *   THE WINDOW IS SET, NOT EXTENDED. A grant is idempotent: the same
 *   action twice leaves one interval, not two. See `periodFor`.
 *
 *   PROVIDER COLUMNS ARE LEFT ALONE. `provider_subscription_id` and
 *   `last_provider_event_id` stay as they are, so D17 renewal lookups and
 *   payment history keep resolving after a comped period.
 *
 *   SYNC FAILURE IS NOT A WRITE FAILURE. The row is committed, the result
 *   says `syncOk: false`, and the caller reports it — the same contract as
 *   `setOrganizationStatus`. Rolling back a deliberate grant because
 *   LiteLLM blinked would make the operator retype it for no benefit; the
 *   hourly reconciler and the existing Retry sync button both repair it.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { plans, organizations, subscriptions } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { periodFor, type PlanInterval } from './grant-schema';

export type GrantPlanError = 'not_found' | 'deleted' | 'plan_not_found';

export type GrantPlanResult =
  | {
      ok: true;
      planCode: string;
      planName: string;
      interval: PlanInterval;
      periodStart: string;
      periodEnd: string;
      /** The plan the org was on before, if any — the audit's `before`. */
      previousPlanCode: string | null;
      previousStatus: string | null;
      syncOk: boolean;
      syncError: string | null;
      effect: string;
      keysSynced: number;
    }
  | { ok: false; error: GrantPlanError };

/**
 * The org's subscription row, chosen the way the entitlement sync chooses
 * it. Duplicated from `sync.ts:resolveSubscription` on purpose rather than
 * exported from there: that function lives in the enforcement path and
 * returns plan limits this module has no use for. If the ordering ever
 * changes, both must change together — hence this comment.
 */
const RESOLVE_SUBSCRIPTION = (orgId: string) => sql`
  SELECT s.id, s.status::text AS status, s.provider_subscription_id,
         p.code AS plan_code
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
   WHERE s.organization_id = ${orgId}::uuid
   ORDER BY (s.status IN ('active','past_due','paused')) DESC,
            s.updated_at DESC
   LIMIT 1
   FOR UPDATE OF s
`;

export async function grantPlan(
  staffId: string,
  orgId: string,
  planCode: string,
): Promise<GrantPlanResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { id: true, status: true },
  });
  if (!org) return { ok: false, error: 'not_found' };
  if (org.status === 'deleted') return { ok: false, error: 'deleted' };

  const plan = await db.query.plans.findFirst({
    where: eq(plans.code, planCode),
  });
  if (!plan) return { ok: false, error: 'plan_not_found' };

  const interval: PlanInterval = plan.interval === 'year' ? 'year' : 'month';
  const now = new Date();
  const { start, end } = periodFor(interval, now);

  // One transaction so the "which row" decision cannot be raced by a
  // webhook landing a D17 approval at the same moment.
  const previous = await db.transaction(async (tx) => {
    const existing = (await tx.execute(RESOLVE_SUBSCRIPTION(orgId))) as unknown as {
      id: string;
      status: string;
      provider_subscription_id: string | null;
      plan_code: string;
    }[];
    const row = existing[0];

    const values = {
      planId: plan.id,
      status: 'active' as const,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      // A grant is a fresh period, not a trial remnant: clearing trial_end
      // stops `trial` logic and the dashboard from calling a comped plan a
      // trial. `dailyQuota` is TRUE because that is the current model
      // (0025) — a newly written period is enforced against the per-alias
      // daily budgets on the plan, exactly like a trial or a new row.
      trialEnd: null,
      dailyQuota: true,
      updatedAt: now,
    };

    if (row) {
      await tx.update(subscriptions).set(values).where(eq(subscriptions.id, row.id));
      return {
        planCode: row.plan_code as string | null,
        status: row.status as string | null,
      };
    }

    await tx.insert(subscriptions).values({ organizationId: orgId, ...values });
    return { planCode: null, status: null };
  });

  // The row is committed. Now make it true at the gateway.
  const sync = await syncOrganizationEntitlements(orgId, 'admin:plan-granted');

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'subscription.admin_granted',
    targetType: 'subscription',
    targetId: orgId,
    before: { planCode: previous.planCode, status: previous.status },
    after: {
      planCode: plan.code,
      status: 'active',
      interval,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: end.toISOString(),
      syncOk: sync.ok,
      syncError: sync.error ?? null,
    },
  });

  return {
    ok: true,
    planCode: plan.code,
    planName: plan.name,
    interval,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    previousPlanCode: previous.planCode,
    previousStatus: previous.status,
    syncOk: sync.ok,
    syncError: sync.error ?? null,
    effect: sync.effect,
    keysSynced: sync.keysSynced,
  };
}
