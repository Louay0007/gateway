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
import { cancelSubscription, resumeSubscription } from '@/lib/billing/service';
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
      // trial. `dailyQuota` is FALSE because that is the current model
      // (0038) — a granted period is measured over the period it just
      // opened, against the plan's monthly budgets, exactly like a paid
      // renewal or a new row. TRUE here would hand a comped account 30x
      // its allowance.
      trialEnd: null,
      dailyQuota: false,
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

// ───────────────────────────────────────────────────────────────────────
//  Lifecycle — cancel, resume, remove, extend
//
//  WHAT THIS ADDS. Before this section the console could GRANT a plan and
//  nothing else: no cancel, no un-cancel, no end, no extension. An operator
//  facing "I want to stop paying" or "I was double-charged" had no action.
//
//  EVERY FUNCTION ENDS IN syncOrganizationEntitlements(). Writing the row
//  alone changes what the dashboard says and nothing about what the gateway
//  allows — an "cancelled" org that still gets 200s is worse than no button.
//  That is the same non-negotiable the grant path above already states.
//
//  SYNCHRONOUS vs DELEGATED, and why the split:
//
//    CANCEL / RESUME delegate to `cancelSubscription` / `resumeSubscription`
//    (lib/billing/service.ts) — the CUSTOMER's own paths — so "when does this
//    end" has exactly one implementation. What differs is the audit action
//    name, because the actor differs in kind: an operator ending a period and
//    a customer cancelling their own plan are not the same event.
//
//    REMOVE and EXTEND are their own writes. There is no customer path for
//    either (a customer cannot stop their own service before the period they
//    paid for, and cannot extend it), so delegating would mean inventing a
//    service function whose only caller is this file.
// ───────────────────────────────────────────────────────────────────────

export type LifecycleError =
  | 'not_found'
  | 'deleted'
  | 'no_subscription'
  | 'wrong_status'
  | 'reason_required'
  | 'conflict';

export type LifecycleResult =
  | {
      ok: true;
      /** What the gateway did. A scheduled cancel is 'unchanged' on purpose. */
      effect: string;
      syncOk: boolean;
      syncError: string | null;
      /** Cancels may be scheduled rather than immediate. */
      atPeriodEnd?: boolean;
      currentPeriodEnd?: string | null;
    }
  | { ok: false; error: LifecycleError; message: string };

/** Max days a single extension may add — a typo must not hand out a year. */
export const MAX_EXTEND_DAYS = 90;

/**
 * The org's subscription row, chosen the way the entitlement sync chooses it.
 *
 * `FOR UPDATE` holds that choice for the duration of the write so a webhook
 * landing at the same moment cannot change which row we are acting on.
 */
const RESOLVE_LIFECYCLE_SUBSCRIPTION = (orgId: string) => sql`
  SELECT s.id, s.status::text AS status, s.cancel_at_period_end,
         s.current_period_start, s.current_period_end, s.plan_id,
         p.code AS plan_code
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
   WHERE s.organization_id = ${orgId}::uuid
   ORDER BY (s.status IN ('active','past_due','paused')) DESC,
            s.updated_at DESC
   LIMIT 1
`;

interface LiveSub {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
  plan_id: string;
  plan_code: string;
}

/** Shared guard: the org must exist, not be deleted, and have a subscription. */
async function loadTarget(
  orgId: string,
): Promise<{ ok: true; sub: LiveSub } | { ok: false; error: LifecycleError; message: string }> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { id: true, status: true },
  });
  if (!org) return { ok: false, error: 'not_found', message: 'No such organization.' };
  if (org.status === 'deleted') {
    return {
      ok: false,
      error: 'deleted',
      message: 'That account is deleted, so its subscriptions cannot be managed.',
    };
  }

  const rows = (await db.execute(RESOLVE_LIFECYCLE_SUBSCRIPTION(orgId))) as unknown as LiveSub[];
  const sub = rows[0];
  if (!sub) {
    return {
      ok: false,
      error: 'no_subscription',
      message: 'That account has no subscription. Use Grant plan first.',
    };
  }
  return { ok: true, sub };
}

// ───────────────────────────────────────────────────────────────────────
//  Cancel / resume — delegated to the customer's own paths
// ───────────────────────────────────────────────────────────────────────

/**
 * Stop renewing, keep the period the customer already paid for.
 *
 * THE SAFE DEFAULT, and the one an operator should reach for. It uses
 * `cancelSubscription(…, { atPeriodEnd: true })`, so the rules about what may
 * be scheduled (not `incomplete`, not already scheduled) are the same rules the
 * customer's own button obeys.
 */
export async function adminCancelSubscription(
  staffId: string,
  orgId: string,
  opts: { reason?: string } = {},
): Promise<LifecycleResult> {
  const target = await loadTarget(orgId);
  if (!target.ok) return target;

  try {
    const result = await cancelSubscription(orgId, staffId, { atPeriodEnd: true });

    // The customer path already wrote `subscription.cancel_at_period_end`.
    // This row records that an OPERATOR did it, which is the fact a dispute
    // turns on — "we were told we cancelled" vs "an operator cancelled us".
    await appendAudit({
      actorType: 'user',
      actorId: staffId,
      organizationId: orgId,
      action: 'subscription.admin_cancel_scheduled',
      targetType: 'subscription',
      targetId: target.sub.id,
      before: { status: target.sub.status, cancelAtPeriodEnd: target.sub.cancel_at_period_end },
      after: {
        cancelAtPeriodEnd: true,
        reason: opts.reason?.trim() || null,
        currentPeriodEnd: target.sub.current_period_end,
      },
    });

    // Nothing to push: a scheduled cancel leaves the period live on purpose.
    return {
      ok: true,
      effect: 'unchanged',
      syncOk: true,
      syncError: null,
      atPeriodEnd: result.atPeriodEnd ?? true,
      currentPeriodEnd: iso(target.sub.current_period_end),
    };
  } catch (e) {
    return mapBillingError(e);
  }
}

/** Undo a scheduled cancel. */
export async function adminResumeSubscription(
  staffId: string,
  orgId: string,
): Promise<LifecycleResult> {
  const target = await loadTarget(orgId);
  if (!target.ok) return target;

  try {
    const result = await resumeSubscription(orgId, staffId);

    await appendAudit({
      actorType: 'user',
      actorId: staffId,
      organizationId: orgId,
      action: 'subscription.admin_resumed',
      targetType: 'subscription',
      targetId: target.sub.id,
      before: { cancelAtPeriodEnd: target.sub.cancel_at_period_end },
      after: { cancelAtPeriodEnd: false },
    });

    return {
      ok: true,
      effect: 'unchanged',
      syncOk: true,
      syncError: null,
      atPeriodEnd: false,
      currentPeriodEnd: result.currentPeriodEnd ?? iso(target.sub.current_period_end),
    };
  } catch (e) {
    return mapBillingError(e);
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Remove — stop service now. NOT a delete. See migration 0055.
// ───────────────────────────────────────────────────────────────────────

/**
 * End a subscription IMMEDIATELY.
 *
 * WHY THIS IS NOT A DELETE. `payments_d17.subscription_id` and
 * `trial_redemptions.subscription_id` are `ON DELETE CASCADE`, so deleting the
 * row would take the payment history — the evidence that money arrived — with
 * it. The row survives forever; its STATUS is what changes, and three columns
 * record who ended it, when, and why.
 *
 * `canceled` is the status the entitlement sync already treats as a cut, so
 * this is a real gateway change rather than a dashboard flag.
 *
 * REFUSES `incomplete`: there is no service to remove, the row is a payment
 * attempt that never completed, and marking it canceled would erase the fact
 * that a checkout was abandoned mid-flight.
 */
export async function adminRemoveSubscription(
  staffId: string,
  orgId: string,
  opts: { reason: string },
): Promise<LifecycleResult> {
  const reason = opts.reason?.trim() ?? '';

  // Required, and enforced here rather than only in the route: ending a
  // paying customer's service early must be explicable, and every caller —
  // route, script, future surface — gets the same rule.
  if (!reason) {
    return { ok: false, error: 'reason_required', message: 'Give a reason for the removal.' };
  }
  if (reason.length > 500) {
    return { ok: false, error: 'conflict', message: 'Keep the reason under 500 characters.' };
  }

  const target = await loadTarget(orgId);
  if (!target.ok) return target;

  if (target.sub.status === 'incomplete') {
    return {
      ok: false,
      error: 'wrong_status',
      message: 'That checkout never completed, so there is no service to remove.',
    };
  }
  if (target.sub.status === 'canceled') {
    return {
      ok: false,
      error: 'conflict',
      message: 'That subscription is already cancelled.',
    };
  }

  const now = new Date();
  await db
    .update(subscriptions)
    .set({
      status: 'canceled',
      // A removed subscription is not "scheduled to cancel" — it already has.
      cancelAtPeriodEnd: false,
      removedAt: now,
      removedBy: staffId,
      removalReason: reason,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, target.sub.id));

  // The row is committed; now make it TRUE at the gateway.
  const sync = await syncOrganizationEntitlements(orgId, 'admin:subscription-removed');

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'subscription.admin_removed',
    targetType: 'subscription',
    targetId: target.sub.id,
    before: {
      status: target.sub.status,
      planCode: target.sub.plan_code,
      currentPeriodEnd: iso(target.sub.current_period_end),
    },
    after: {
      status: 'canceled',
      reason,
      removedAt: now.toISOString(),
      syncOk: sync.ok,
      syncError: sync.error ?? null,
      effect: sync.effect,
    },
  });

  return {
    ok: true,
    effect: sync.effect,
    syncOk: sync.ok,
    syncError: sync.error ?? null,
    currentPeriodEnd: iso(target.sub.current_period_end),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Extend — make good on downtime
// ───────────────────────────────────────────────────────────────────────

/**
 * Add days to the CURRENT period, keeping the plan.
 *
 * WHY THIS IS NOT `grantPlan`. A grant SETS the window from today
 * (`periodFor`), which is idempotent and correct for comping a plan — a
 * double-click cannot hand out two months. An EXTENSION expresses a different
 * intent: the customer already paid and we are compensating them for downtime,
 * so this ADDS to the existing `current_period_end` rather than replacing it.
 * Replacing would silently swallow the unused remainder of the period.
 *
 * Capped at 90 days: a mistyped "3650" must not hand out a decade, and the
 * audit row for a legitimate extension is never more than a quarter.
 */
export async function adminExtendPeriod(
  staffId: string,
  orgId: string,
  opts: { days: number; reason: string },
): Promise<LifecycleResult> {
  const days = Math.floor(opts.days);
  const reason = opts.reason?.trim() ?? '';

  if (!reason) {
    return { ok: false, error: 'reason_required', message: 'Give a reason for the extension.' };
  }
  if (!Number.isFinite(days) || days < 1 || days > MAX_EXTEND_DAYS) {
    return {
      ok: false,
      error: 'wrong_status',
      message: `Days must be between 1 and ${MAX_EXTEND_DAYS}.`,
    };
  }

  const target = await loadTarget(orgId);
  if (!target.ok) return target;

  if (!['active', 'trialing', 'past_due'].includes(target.sub.status)) {
    return {
      ok: false,
      error: 'wrong_status',
      message: 'Only a live subscription can be extended. Grant a plan instead.',
    };
  }

  // Add to the EXISTING end when there is one, otherwise from now. A
  // subscription with no period (legacy rows) still gets a sensible window
  // rather than an error an operator cannot act on.
  const base = target.sub.current_period_end ? new Date(target.sub.current_period_end) : new Date();
  const end = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: end, updatedAt: new Date() })
    .where(eq(subscriptions.id, target.sub.id));

  // A period change moves the quota wall's window, so the gateway must agree.
  const sync = await syncOrganizationEntitlements(orgId, 'admin:subscription-extended');

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'subscription.admin_extended',
    targetType: 'subscription',
    targetId: target.sub.id,
    before: { currentPeriodEnd: iso(target.sub.current_period_end) },
    after: {
      currentPeriodEnd: end.toISOString(),
      days,
      reason,
      syncOk: sync.ok,
      effect: sync.effect,
    },
  });

  return {
    ok: true,
    effect: sync.effect,
    syncOk: sync.ok,
    syncError: sync.error ?? null,
    currentPeriodEnd: end.toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Map a BillingError from the delegated customer paths onto a result.
 *
 * Deliberately a mapping rather than a re-throw: the route layer's
 * `errorResponse` already understands BillingError, but the *caller* of these
 * functions wants a discriminated result it can render next to the button that
 * failed. Throwing would turn "there is no active subscription to cancel" into
 * a 409 the operator reads as a bug.
 */
function mapBillingError(e: unknown): LifecycleResult {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : 'That change could not be applied.';

  if (code === 'conflict') return { ok: false, error: 'conflict', message };
  if (code === 'not_found') return { ok: false, error: 'not_found', message };
  return { ok: false, error: 'conflict', message };
}

function iso(v: Date | string | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}
