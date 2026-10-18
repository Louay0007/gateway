/**
 * Subscription lifecycle — the state machine, provider-neutral.
 *
 * MVP shape (2026-10-11): individual accounts, two plans, no trials, no
 * free tier. A new account owns an org and a LiteLLM team but NO
 * subscription — that absence IS the paywall (`planState ===
 * 'no_subscription'`), and it is what stops key creation before payment.
 *
 * The machine:
 *
 *   no_subscription ──beginCheckout──▶ incomplete ──callback(activated)──▶ active
 *                                          │                              │
 *                                          │                    payment_failed│
 *                                          │                              ▼
 *                                          │                           past_due ─┐
 *                                          │                              │      │ activated
 *                                    (expired: stays incomplete,          │      │
 *                                     a new checkout reuses the row)     │      │
 *                                          │                    canceled ◀┘──────┘
 *                                          ▼
 *                                    changePlan (live subs only) ──▶ sync
 *
 * Two rules the implementation refuses to break:
 *
 *   1. EVERY transition calls syncOrganizationEntitlements(). The
 *      gateway is the enforcement point; local rows are the cache. A
 *      transition that does not push is a customer who paid (or
 *      cancelled) with no matching access change.
 *
 *   2. Callbacks are idempotent. `billing_events` dedupes on the
 *      provider's event id BEFORE any state change (PLATFORM.md §6.2),
 *      so a replayed callback is a no-op, not a double-activation.
 *
 * `past_due` deliberately keeps access: grace period, cut on `unpaid`.
 * The status→effect map already encodes that in lib/entitlements/policy.
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  apiKeys,
  auditLog,
  billingEvents,
  entitlements,
  organizations,
  plans,
  subscriptions,
  usageRecords,
} from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import {
  BillingError,
  planStateFromStatus,
  summarizePlan,
  type PlanState,
  type PlanSummary,
} from './state';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { billingProvider, resolveBillingProvider } from './index';
import { log } from '@/lib/log';
import type { ProviderEvent } from './types';

// ───────────────────────────────────────────────────────────────────────
//  Reading state
// ───────────────────────────────────────────────────────────────────────

/** The org's one subscription row, if any.
 *
 * Newest-first by created_at so that if an org ever has multiple rows
 * (e.g., after a migration bug or a future multi-subscription feature),
 * we always read the latest rather than an arbitrary one. Mirrors the
 * same pattern used by loadD17Payment() for the same reason. */
async function loadSubscription(organizationId: string) {
  return db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

async function loadPlan(planId: string) {
  return db.query.plans.findFirst({ where: eq(plans.id, planId) });
}

export async function planStateFor(organizationId: string): Promise<{
  state: PlanState;
  plan: PlanSummary | null;
  subscription: typeof subscriptions.$inferSelect | null;
}> {
  const sub = await loadSubscription(organizationId);
  if (!sub) return { state: 'no_subscription', plan: null, subscription: null };
  const plan = await loadPlan(sub.planId);
  return {
    state: planStateFromStatus(sub.status),
    plan: plan ? summarizePlan(plan) : null,
    subscription: sub,
  };
}

/** Public plans, cheapest first — the pricing page and the chooser. */
export async function listPlans(): Promise<PlanSummary[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.public, true))
    .orderBy(plans.sortOrder);
  return rows.map(summarizePlan);
}

// ───────────────────────────────────────────────────────────────────────
//  The dashboard bundle — "my plan, my limits, my usage"
// ───────────────────────────────────────────────────────────────────────

function currentPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Usage window for an org: the SUBSCRIPTION period when one exists,
 * calendar month otherwise.
 *
 * `billing_period` on the ledger is date_trunc('month', occurred_at) — a
 * CALENDAR month. A D17 subscription starting on the 20th spans two
 * buckets, and one bucket can hold two periods. For allowance math
 * ("$X of $20 included") the grouping key must be the period the customer
 * paid for (current_period_start → current_period_end), not the month the
 * wall clock says. The rollup keeps calendar buckets (it is a chart
 * accelerator); the bundle — the number a customer is shown — uses the
 * subscription window.
 */
function usageWindowFor(
  subscription: { currentPeriodStart: Date | null; currentPeriodEnd: Date | null } | null,
): { start: Date; end: Date } {
  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
  }
  const p = currentPeriod();
  return { start: new Date(p.start), end: new Date(p.end) };
}

/**
 * Everything the dashboard renders, derived from the ledger.
 *
 * PLATFORM.md §8.2: "Every number shown must be derivable from
 * usage_records" — so usage is aggregated from the ledger here, not read
 * from the rollup cache. The rollup stays what it is (a fast cache for
 * charts), and never the thing the customer's spend number comes from.
 */
export async function subscriptionBundle(organizationId: string): Promise<{
  state: PlanState;
  plan: PlanSummary | null;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  entitlement: { status: string; syncedAt: string | null; lastError: string | null } | null;
  period: { start: string; end: string };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUpstreamUsd: number;
    costCustomerUsd: number;
  };
  /** Per-alias prompt counts for the current billing period. Migration 0013. */
  promptsByModel: Record<string, number>;
  limits: PlanSummary | null;
  keys: { active: number; max: number | null };
}> {
  const [{ state, plan, subscription }, ent, usage, activeKeys] = await Promise.all([
    planStateFor(organizationId),
    db.query.entitlements.findFirst({
      where: eq(entitlements.organizationId, organizationId),
    }),
    (async () => {
      // Window first: subscription period when known, calendar fallback.
      // The window must be known before the query, but planStateFor runs
      // concurrently above — so load the subscription row here too. One
      // extra indexed lookup is cheaper than attributing spend to the
      // wrong period.
      const subRow = await loadSubscription(organizationId);
      const window = usageWindowFor(
        subRow ? { currentPeriodStart: subRow.currentPeriodStart, currentPeriodEnd: subRow.currentPeriodEnd } : null,
      );
      const [row] = await db
        .select({
          requests: sql<number>`count(*)`,
          inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
          cacheReadTokens: sql<number>`coalesce(sum(${usageRecords.cacheReadTokens}), 0)`,
          costUpstreamUsd: sql<string>`coalesce(sum(${usageRecords.costUpstreamUsd}), 0)`,
          costCustomerUsd: sql<string>`coalesce(sum(${usageRecords.costCustomerUsd}), 0)`,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.organizationId, organizationId),
            sql`${usageRecords.occurredAt} >= ${window.start.toISOString()}::timestamptz`,
            sql`${usageRecords.occurredAt} < ${window.end.toISOString()}::timestamptz`,
          ),
        );

      // Per-model prompt counts for the same window. Migration 0013 added
      // prompt_count (1 for inference rows, 0 otherwise). The model column
      // already holds the alias (fast/smart/frontier) via aliasForRow().
      const promptRows = await db.execute(sql`
        SELECT u.model, coalesce(sum(u.prompt_count), 0)::int AS prompts
          FROM usage_records u
         WHERE u.organization_id = ${organizationId}::uuid
           AND u.occurred_at >= ${window.start.toISOString()}::timestamptz
           AND u.occurred_at <  ${window.end.toISOString()}::timestamptz
         GROUP BY u.model
      `) as unknown as { model: string; prompts: number }[];

      const promptsByModel: Record<string, number> = {};
      for (const r of promptRows) {
        if (r.model && r.prompts > 0) promptsByModel[r.model] = r.prompts;
      }

      return {
        requests: Number(row?.requests ?? 0),
        inputTokens: Number(row?.inputTokens ?? 0),
        outputTokens: Number(row?.outputTokens ?? 0),
        cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
        costUpstreamUsd: Number(row?.costUpstreamUsd ?? 0),
        costCustomerUsd: Number(row?.costCustomerUsd ?? 0),
        promptsByModel,
        window,
      };
    })(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.organizationId, organizationId),
          sql`${apiKeys.revokedAt} IS NULL`,
        ),
      ),
      ]);

  return {
    state,
    plan,
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    entitlement: ent
      ? { status: ent.status, syncedAt: ent.syncedAt?.toISOString() ?? null, lastError: ent.lastError }
      : null,
    // The period the usage window actually covers: subscription period
    // when known, calendar fallback. This is what the SpendMeter's "of
    // $20 included" is measured against — not always the calendar month.
    period: {
      start: usage.window.start.toISOString(),
      end: usage.window.end.toISOString(),
    },
    usage: {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUpstreamUsd: usage.costUpstreamUsd,
      costCustomerUsd: usage.costCustomerUsd,
    },
    promptsByModel: usage.promptsByModel,
    limits: plan,
    keys: { active: Number(activeKeys[0]?.count ?? 0), max: plan?.maxKeys ?? null },
  };
}

// ───────────────────────────────────────────────────────────────────────
//  The lifecycle
// ───────────────────────────────────────────────────────────────────────

function periodEndFromNow(): Date {
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/**
 * Renewal window: a live subscription may start checkout again when its
 * period ends within this many days, or has already lapsed (grace).
 * Outside the window the same-plan 409 stands.
 */
export const RENEWAL_WINDOW_DAYS = 7;

function isRenewable(sub: typeof subscriptions.$inferSelect): boolean {
  if (!sub.currentPeriodEnd) return true; // no period yet — treat as renewable
  const now = new Date();
  const windowStart = new Date(sub.currentPeriodEnd.getTime() - RENEWAL_WINDOW_DAYS * 86400000);
  return now >= windowStart;
}

async function planByCode(planCode: string) {
  const plan = await db.query.plans.findFirst({ where: eq(plans.code, planCode) });
  if (!plan || !plan.public) {
    throw new BillingError('validation', 'That plan is not available.');
  }
  return plan;
}

/**
 * Start checkout. Creates (or reuses) the org's single subscription row
 * in `incomplete` and asks the provider where to pay.
 *
 * `providerName` is the customer's payment-method choice ('d17' picks
 * the La Poste flow even when another provider is the deployment
 * default). Absent → the configured provider. Reuse rather than insert:
 * the org has exactly one subscription row across its lifetime. A second
 * live row would violate `subscriptions_one_live_idx`, and a row per
 * attempt would leave canceled debris for the admin tooling to sweep.
 *
 * RENEWALS (0007): a live subscription on the SAME plan may start checkout
 * again when its period ends within RENEWAL_WINDOW_DAYS or has already
 * lapsed. Outside the window the 409 stands — an "already subscribed"
 * customer clicking checkout mid-period has a stale page, not a renewal.
 * A live subscription on a DIFFERENT plan still 409s: that path is
 * `changePlan`, not checkout. The one-row-per-org invariant is preserved:
 * renewal reuses the same row, rolling its period forward on activation.
 */
export async function beginCheckout(
  organizationId: string,
  planCode: string,
  actorUserId: string,
  providerName?: string | null,
): Promise<{ intent: Awaited<ReturnType<typeof billingProvider.begin>>; changed: boolean }> {
  const provider = resolveBillingProvider(providerName);
  const plan = await planByCode(planCode);

  // A suspended account must not be able to re-enter the money path. The
  // entitlement sync already cuts a suspended org's keys; this stops the
  // checkout button from creating new payment claims on top of a frozen
  // account (0009 admin console).
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (org && org.status !== 'active') {
    throw new BillingError(
      'forbidden',
      'This account is suspended. Contact support before subscribing.',
    );
  }

  const existing = await loadSubscription(organizationId);

  if (existing) {
    const live = ['active', 'past_due', 'paused'].includes(existing.status);
    if (live) {
      if (existing.planId !== plan.id) {
        throw new BillingError(
          'conflict',
          'You already have an active subscription — change your plan instead of checking out again.',
        );
      }
      // Same plan, live: only a renewal in window may proceed.
      if (!isRenewable(existing)) {
        throw new BillingError('conflict', 'You are already subscribed to this plan.');
      }
      // In window: fall through to provider.begin, which creates a new
      // payment row for the next period (d17.ts reuses an open row if one
      // is already alive, so double-clicking checkout cannot pile up).
    }
  }

  const now = new Date();
  const isRenewal = Boolean(
    existing &&
      ['active', 'past_due', 'paused'].includes(existing.status) &&
      existing.planId === plan.id,
  );

  const sub = !existing
    ? (
        await db
          .insert(subscriptions)
          .values({
            organizationId,
            planId: plan.id,
            status: 'incomplete',
            updatedAt: now,
          })
          .returning()
      )[0]
    : isRenewal
      ? existing
      : (
          await db
            .update(subscriptions)
            .set({
              planId: plan.id,
              status: 'incomplete',
              providerCustomerId: existing.providerCustomerId,
              providerSubscriptionId: null,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              updatedAt: now,
            })
            .where(eq(subscriptions.id, existing.id))
            .returning()
        )[0];

  if (!sub) throw new BillingError('internal', 'Could not start checkout.');

  const intent = await provider.begin({
    organizationId,
    planCode,
    subscriptionId: sub.id,
    returnUrl: '/dashboard/billing',
  });

  await db
    .update(subscriptions)
    .set({ providerSubscriptionId: intent.providerReference, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  await appendAudit({
    actorType: 'user',
    actorId: actorUserId,
    organizationId,
    action: 'subscription.checkout_started',
    targetType: 'subscription',
    targetId: sub.id,
    after: { planCode, provider: provider.name },
  });

  return { intent, changed: true };
}

/**
 * Apply a verified provider callback. Idempotent by event id.
 *
 * The insert into `billing_events` IS the idempotency: if the event was
 * seen before the function returns early, before touching the
 * subscription. A callback we cannot apply (unknown org, plan mismatch)
 * is recorded with its error and rethrown, so the provider retries.
 */
export async function applyCallback(event: ProviderEvent): Promise<{
  applied: boolean;
  duplicate: boolean;
  state: PlanState;
}> {
  const claimed = await db
    .insert(billingEvents)
    .values({ id: event.id, type: event.kind })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });

  if (claimed.length === 0) {
    return { applied: false, duplicate: true, state: 'active' };
  }

  try {
    const sub = await loadSubscription(event.organizationId);
    if (!sub) {
      throw new BillingError('not_found', 'No subscription matches this payment.');
    }

    const plan = await loadPlan(sub.planId);
    if (!plan) throw new BillingError('not_found', 'Plan for this subscription is missing.');

    if (event.planCode && event.planCode !== plan.code) {
      throw new BillingError('conflict', 'Payment plan does not match the subscription.');
    }

    const before = { status: sub.status, planCode: plan.code };

    if (event.kind === 'subscription.activated') {
      // Period roll-forward, not "now + 1mo" blindly. A renewal approved
      // before the old period ends must start at the OLD end (early renewal
      // keeps its overlap days); a lapsed renewal starts now. Using now in
      // both cases would silently steal up to RENEWAL_WINDOW_DAYS from
      // every customer who pays early — the exact customers who pay on time.
      // An explicit event.periodEnd (dev provider, tests) wins when present.
      const now = new Date();
      let start: Date;
      let end: Date;
      if (event.periodEnd) {
        end = new Date(event.periodEnd);
        start = sub.currentPeriodStart ?? now;
        // If the event carries only an end (dev flow), derive start as
        // end minus one month rather than now, so early/late both read
        // correctly.
        if (!sub.currentPeriodStart || sub.status === 'incomplete') {
          start = new Date(end.getTime());
          start.setUTCMonth(start.getUTCMonth() - 1);
        }
      } else if (
        sub.currentPeriodEnd &&
        sub.currentPeriodEnd > now &&
        ['active', 'past_due', 'paused'].includes(sub.status)
      ) {
        start = sub.currentPeriodEnd;
        end = new Date(start.getTime());
        end.setUTCMonth(end.getUTCMonth() + 1);
      } else {
        start = now;
        end = periodEndFromNow();
      }
      await db
        .update(subscriptions)
        .set({
          status: 'active',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: false,
          lastProviderEventId: event.id,
          lastProviderEventAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } else if (event.kind === 'subscription.payment_failed') {
      // Grace period. Access stays; the banner is the nudge.
      await db
        .update(subscriptions)
        .set({
          status: sub.status === 'active' ? 'past_due' : sub.status,
          lastProviderEventId: event.id,
          lastProviderEventAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    } else if (event.kind === 'subscription.canceled') {
      await db
        .update(subscriptions)
        .set({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          lastProviderEventId: event.id,
          lastProviderEventAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    }

    // THE rule: every transition pushes to the gateway.
    const sync = await syncOrganizationEntitlements(event.organizationId, `billing:${event.kind}`);
    if (!sync.ok) {
      throw new BillingError('upstream', `Entitlement sync failed: ${sync.error ?? 'unknown'}`);
    }

    const after = { status: event.kind, planCode: plan.code };
    await appendAudit({
      actorType: 'provider',
      actorId: event.id,
      organizationId: event.organizationId,
      action: `subscription.${event.kind}`,
      targetType: 'subscription',
      targetId: sub.id,
      before,
      after: { ...after, provider: billingProvider.name },
    });

    await db
      .update(billingEvents)
      .set({ processedAt: new Date() })
      .where(eq(billingEvents.id, event.id));

    const { state } = await planStateFor(event.organizationId);
    return { applied: true, duplicate: false, state };
  } catch (e) {
    await db
      .update(billingEvents)
      .set({
        attempts: sql`${billingEvents.attempts} + 1`,
        lastError: e instanceof Error ? e.message : String(e),
      })
      .where(eq(billingEvents.id, event.id));
    throw e;
  }
}

/**
 * Switch plans on a live subscription.
 *
 * The local row and the gateway limits change immediately; the
 * provider-side price change is a renewal-time swap until the chosen
 * PSP's proration API is wired (recorded in lib/billing/d17.ts).
 */
export async function changePlan(
  organizationId: string,
  planCode: string,
  actorUserId: string,
): Promise<{ plan: PlanSummary }> {
  const plan = await planByCode(planCode);
  const sub = await loadSubscription(organizationId);

  if (!sub || !['active', 'past_due', 'paused'].includes(sub.status)) {
    throw new BillingError('conflict', 'There is no active subscription to change.');
  }
  if (sub.planId === plan.id) {
    throw new BillingError('conflict', 'You are already subscribed to this plan.');
  }

  const before = { planCode: (await loadPlan(sub.planId))?.code ?? null, status: sub.status };
  await db
    .update(subscriptions)
    .set({ planId: plan.id, cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  const sync = await syncOrganizationEntitlements(organizationId, 'billing:plan-changed');
  if (!sync.ok) {
    throw new BillingError('upstream', `Entitlement sync failed: ${sync.error ?? 'unknown'}`);
  }

  await appendAudit({
    actorType: 'user',
    actorId: actorUserId,
    organizationId,
    action: 'subscription.plan_changed',
    targetType: 'subscription',
    targetId: sub.id,
    before,
    after: { planCode, provider: billingProvider.name },
  });

  return { plan: summarizePlan(plan) };
}

/**
 * Cancel. Two modes:
 *
 *   immediate (default) — provider first, then local, then sync. Access
 *     is cut now. If the provider refuses, the local cut still happens:
 *     a customer who asked to stop must stop being able to spend, even
 *     if the provider's cancellation call fails — the failure is
 *     surfaced so billing can be refunded/handled manually, and the
 *     audit row records both halves.
 *
 *   atPeriodEnd — the kind cancel. `cancel_at_period_end` is set and
 *     NOTHING else changes: the customer keeps full access until
 *     `current_period_end`, because they paid for it. The
 *     `expire_subscriptions` job flips the status when the period
 *     actually ends (PLATFORM.md §5.3: SQL first, then push).
 */
export async function cancelSubscription(
  organizationId: string,
  actorUserId: string,
  options: { atPeriodEnd?: boolean } = {},
): Promise<{ providerError?: string; atPeriodEnd?: boolean }> {
  const sub = await loadSubscription(organizationId);
  if (!sub || !['active', 'past_due', 'paused', 'incomplete'].includes(sub.status)) {
    throw new BillingError('conflict', 'There is no active subscription to cancel.');
  }

  if (options.atPeriodEnd) {
    if (sub.status === 'incomplete') {
      // A payment that never completed has no period to keep until.
      throw new BillingError('conflict', 'This subscription has not started yet.');
    }
    if (sub.cancelAtPeriodEnd) {
      throw new BillingError('conflict', 'This subscription is already set to cancel.');
    }
    await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    await appendAudit({
      actorType: 'user',
      actorId: actorUserId,
      organizationId,
      action: 'subscription.cancel_at_period_end',
      targetType: 'subscription',
      targetId: sub.id,
      after: {
        provider: billingProvider.name,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      },
    });

    // No sync: access is unchanged until the period ends.
    return { atPeriodEnd: true };
  }

  let providerError: string | undefined;
  try {
    await billingProvider.cancel({
      organizationId,
      providerSubscriptionId: sub.providerSubscriptionId,
    });
  } catch (e) {
    providerError = e instanceof Error ? e.message : String(e);
    log.error('billing: provider cancel failed', { organizationId, error: providerError });
  }

  await db
    .update(subscriptions)
    .set({ status: 'canceled', cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  const sync = await syncOrganizationEntitlements(organizationId, 'billing:canceled');
  if (!sync.ok) {
    throw new BillingError('upstream', `Entitlement sync failed: ${sync.error ?? 'unknown'}`);
  }

  await appendAudit({
    actorType: 'user',
    actorId: actorUserId,
    organizationId,
    action: 'subscription.canceled',
    targetType: 'subscription',
    targetId: sub.id,
    after: { provider: billingProvider.name, providerError: providerError ?? null },
  });

  return providerError ? { providerError } : {};
}

/**
 * Undo a pending "cancel at period end".
 *
 * The dashboard has always offered "Resume subscription", but nothing
 * could answer it: `cancelSubscription` is the only writer of
 * `cancelAtPeriodEnd`, and it only ever sets it to `true`. A customer who
 * clicked cancel by accident had no way back except contacting support.
 *
 * Guarded so it can only ever UNDO a pending cancellation:
 *   - the row must still be `active` — once the period has ended,
 *     `expire_subscriptions` has canceled it and the only route back is a
 *     new checkout (which reuses this same row);
 *   - `cancelAtPeriodEnd` must be true, otherwise there is nothing to undo
 *     and the caller's model of the account is stale.
 *
 * NO SYNC. Access never changed, so nothing changed for the gateway to
 * enforce — exactly like the `atPeriodEnd` cancel, which also deliberately
 * pushes nothing (see `cancelSubscription`).
 */
export async function resumeSubscription(
  organizationId: string,
  actorUserId: string,
): Promise<{ resumed: true; currentPeriodEnd: string | null }> {
  const sub = await loadSubscription(organizationId);
  if (!sub || sub.status !== 'active') {
    throw new BillingError('conflict', 'There is no active subscription to resume.');
  }
  if (!sub.cancelAtPeriodEnd) {
    throw new BillingError('conflict', 'This subscription is not scheduled to cancel.');
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  await appendAudit({
    actorType: 'user',
    actorId: actorUserId,
    organizationId,
    action: 'subscription.resumed',
    targetType: 'subscription',
    targetId: sub.id,
    after: {
      provider: billingProvider.name,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    },
  });

  return {
    resumed: true,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Usage history — the ledger, filtered and paginated
// ───────────────────────────────────────────────────────────────────────

/**
 * One ledger row as the API returns it.
 *
 * NOT the raw `usage_records` row. Three things differ, each because the
 * raw row is the wrong shape for a client:
 *
 *   1. `cost_*_usd` are NUMERIC(14,8), which postgres-js hands back as
 *      STRINGS. `subscriptionBundle` has always `Number()`-ed them; this
 *      was the one endpoint that did not, so the dashboard's
 *      `usdPrecise(row.cost)` — `toLocaleString({style:"currency"})` —
 *      would have received a string.
 *   2. Timestamps are `Date` objects here and ISO strings everywhere else
 *      in the API (`subscriptionBundle` already serialises).
 *   3. `keyName` is joined in. The ledger stores `api_key_id`; a client
 *      holding only the ledger has a UUID and nothing to show in a "which
 *      key was this" column. Doing the join here means the dashboard does
 *      not need a second request to label its rows.
 *
 * `latencyMs` and `statusCode` stay nullable, because they genuinely are:
 * the collector writes `latency_ms` as NULL (it is not measured), and
 * `statusCodeForRow` returns NULL when LiteLLM reports "failure" without
 * saying how. `null` is the honest answer; a 0 or a guessed 500 is not.
 */
export interface UsageRowView {
  id: number;
  occurredAt: string;
  billingPeriod: string;
  model: string;
  route: string;
  apiKeyId: string | null;
  keyName: string | null;
  memberUserId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  latencyMs: number | null;
  statusCode: number | null;
  costUpstreamUsd: number;
  costCustomerUsd: number;
}

export interface UsageHistoryQuery {
  from?: string;
  to?: string;
  /**
   * Exact alias match — `fast` / `smart` / `frontier`. These are the only
   * names the gateway serves; upstream model ids are never recorded here.
   */
  model?: string;
  /** A single key, for the "show me this key's traffic" affordance. */
  apiKeyId?: string;
  page?: number;
  pageSize?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function usageHistory(
  organizationId: string,
  query: UsageHistoryQuery,
): Promise<{
  rows: UsageRowView[];
  total: number;
  page: number;
  pageSize: number;
  /** Aggregates over the same filter as `rows`. */
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costCustomerUsd: number;
    costUpstreamUsd: number;
  };
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));

  const conditions: SQL[] = [sql`u.organization_id = ${organizationId}::uuid`];

  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) {
      conditions.push(sql`u.occurred_at >= ${from.toISOString()}::timestamptz`);
    }
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) {
      conditions.push(sql`u.occurred_at <= ${to.toISOString()}::timestamptz`);
    }
  }
  if (query.model) {
    conditions.push(sql`u.model = ${query.model}`);
  }
  if (query.apiKeyId) {
    // Validated before it reaches the query: a garbage id must be an
    // empty result, never a database error surfaced as a 500.
    if (!UUID_RE.test(query.apiKeyId)) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totals: {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          costCustomerUsd: 0,
          costUpstreamUsd: 0,
        },
      };
    }
    conditions.push(sql`u.api_key_id = ${query.apiKeyId}::uuid`);
  }

  const where = sql.join(conditions, sql` AND `);

  const [rawRows, countRow, aggRow] = await Promise.all([
    db.execute(sql`
      SELECT u.id,
             u.occurred_at,
             u.billing_period,
             u.model,
             u.route,
             u.api_key_id,
             k.name            AS key_name,
             u.member_user_id,
             u.input_tokens,
             u.output_tokens,
             u.cache_write_5m_tokens,
             u.cache_write_1h_tokens,
             u.cache_read_tokens,
             u.latency_ms,
             u.status_code,
             u.cost_upstream_usd,
             u.cost_customer_usd
        FROM usage_records u
        LEFT JOIN api_keys k ON k.id = u.api_key_id
       WHERE ${where}
       ORDER BY u.occurred_at DESC, u.id DESC
       LIMIT ${pageSize}
       OFFSET ${(page - 1) * pageSize}
    `) as Promise<
      {
        id: number;
        occurred_at: Date;
        billing_period: Date | string;
        model: string;
        route: string;
        api_key_id: string | null;
        key_name: string | null;
        member_user_id: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
        cache_write_5m_tokens: number | null;
        cache_write_1h_tokens: number | null;
        cache_read_tokens: number | null;
        latency_ms: number | null;
        status_code: number | null;
        cost_upstream_usd: string | null;
        cost_customer_usd: string | null;
      }[]
    >,
    db.execute(sql`
      SELECT count(*)::int AS n FROM usage_records u WHERE ${where}
    `) as Promise<{ n: number }[]>,

    // Totals for the SAME filter as the rows.
    //
    // Without this the Usage page's summary cards have to be computed in
    // the browser from the current page of rows — which makes "1,284
    // requests" mean "the 50 rows on screen", or forces the cards to come
    // from a different endpoint and disagree with the table. One extra
    // aggregate over the same WHERE is cheaper than either.
    //
    // Latency is deliberately absent: `latency_ms` is written NULL by the
    // collector (it is not measured), so an average over it would be a
    // fabricated number with a real-looking unit.
    db.execute(sql`
      SELECT count(*)::int                              AS requests,
             coalesce(sum(u.input_tokens), 0)::bigint     AS input_tokens,
             coalesce(sum(u.output_tokens), 0)::bigint    AS output_tokens,
             coalesce(sum(u.cache_read_tokens), 0)::bigint AS cache_read_tokens,
             coalesce(sum(u.cost_customer_usd), 0)        AS cost_customer,
             coalesce(sum(u.cost_upstream_usd), 0)        AS cost_upstream
        FROM usage_records u
       WHERE ${where}
    `) as Promise<{
      requests: number;
      input_tokens: string;
      output_tokens: string;
      cache_read_tokens: string;
      cost_customer: string;
      cost_upstream: string;
    }[]>,
  ]);

  const agg = aggRow[0];

  const rows: UsageRowView[] = rawRows.map((r) => ({
    id: Number(r.id),
    occurredAt:
      r.occurred_at instanceof Date
        ? r.occurred_at.toISOString()
        : new Date(String(r.occurred_at)).toISOString(),
    billingPeriod:
      r.billing_period instanceof Date
        ? r.billing_period.toISOString().slice(0, 10)
        : String(r.billing_period).slice(0, 10),
    model: r.model,
    route: r.route,
    apiKeyId: r.api_key_id,
    keyName: r.key_name,
    memberUserId: r.member_user_id,
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cacheWrite5mTokens: Number(r.cache_write_5m_tokens ?? 0),
    cacheWrite1hTokens: Number(r.cache_write_1h_tokens ?? 0),
    cacheReadTokens: Number(r.cache_read_tokens ?? 0),
    latencyMs: r.latency_ms === null ? null : Number(r.latency_ms),
    statusCode: r.status_code === null ? null : Number(r.status_code),
    costUpstreamUsd: Number(r.cost_upstream_usd ?? 0),
    costCustomerUsd: Number(r.cost_customer_usd ?? 0),
  }));

  return {
    rows,
    total: Number(countRow[0]?.n ?? 0),
    page,
    pageSize,
    totals: {
      requests: Number(agg?.requests ?? 0),
      inputTokens: Number(agg?.input_tokens ?? 0),
      outputTokens: Number(agg?.output_tokens ?? 0),
      cacheReadTokens: Number(agg?.cache_read_tokens ?? 0),
      costCustomerUsd: Number(agg?.cost_customer ?? 0),
      costUpstreamUsd: Number(agg?.cost_upstream ?? 0),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
//  usageHistorySeries — the real, dense, server-bucketed series
// ───────────────────────────────────────────────────────────────────────

export type UsageBucket = 'day' | 'hour';

export interface UsageSeriesPoint {
  /** Bucket start, ISO-8601 UTC. */
  bucket: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costCustomerUsd: number;
  costUpstreamUsd: number;
}

export interface UsageSeriesQuery {
  bucket?: UsageBucket;
  from?: string;
  to?: string;
  model?: string;
  apiKeyId?: string;
}

export interface UsageSeries {
  bucket: UsageBucket;
  /** The resolved window, ISO-8601 UTC, aligned to bucket boundaries. */
  from: string;
  to: string;
  /** Dense: one point per bucket in [from, to], zero where there was no traffic. */
  points: UsageSeriesPoint[];
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costCustomerUsd: number;
    costUpstreamUsd: number;
  };
}

/** Hard cap on returned points, so `bucket=hour` cannot request a year. */
export const MAX_SERIES_POINTS = 1000;
/** Default window when the caller sends none: the last 30 days, by day. */
export const DEFAULT_SERIES_DAYS = 30;

function truncUtcToBucket(d: Date, bucket: UsageBucket): Date {
  const x = new Date(d.getTime());
  x.setUTCMinutes(0, 0, 0);
  if (bucket === 'day') x.setUTCHours(0, 0, 0);
  return x;
}

/**
 * A real bucketed series over the caller's ledger.
 *
 * WHY THIS EXISTS. The dashboard chart used to bucket the 25 rows of ONE
 * page client-side and print the min/max of that page as a "date range".
 * It could never show more than a page of days, and a quiet day simply did
 * not appear — the chart drew a lie by omission with no error.
 *
 * Two rules make it honest:
 *   1. The series is DENSE. Every bucket between `from` and `to` is present;
 *      a day with no traffic is an explicit zero, not a missing point.
 *   2. The window and the filters are the SAME ones `/api/usage` uses, so
 *      the chart and the table can never describe different data.
 *
 * `generate_series` is the density mechanism: it emits the bucket spine in
 * Postgres and LEFT JOINs the traffic onto it, so the zero-fill is a
 * database fact rather than client arithmetic.
 */
export async function usageHistorySeries(
  organizationId: string,
  query: UsageSeriesQuery,
): Promise<UsageSeries | { error: 'range_too_large' }> {
  const bucket: UsageBucket = query.bucket === 'hour' ? 'hour' : 'day';

  const now = new Date();
  const to = truncUtcToBucket(query.to ? new Date(query.to) : now, bucket);
  const from = truncUtcToBucket(
    query.from ? new Date(query.from) : new Date(now.getTime() - DEFAULT_SERIES_DAYS * 86_400_000),
    bucket,
  );

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { error: 'range_too_large' };
  }

  const stepMs = bucket === 'hour' ? 3_600_000 : 86_400_000;
  const pointCount = Math.floor((to.getTime() - from.getTime()) / stepMs) + 1;
  if (pointCount > MAX_SERIES_POINTS) {
    // An hour-bucketed year is 8760 points; refuse rather than truncate,
    // because a silent cut-off is the same lie the old chart told.
    return { error: 'range_too_large' };
  }

  const conditions: SQL[] = [sql`u.organization_id = ${organizationId}::uuid`];
  if (query.model) conditions.push(sql`u.model = ${query.model}`);
  if (query.apiKeyId && UUID_RE.test(query.apiKeyId)) {
    conditions.push(sql`u.api_key_id = ${query.apiKeyId}::uuid`);
  }
  const where = sql.join(conditions, sql` AND `);

  // date_trunc needs a literal unit, not a bound parameter (`date_trunc($1,…)`
  // is legal but the planner cannot use a bucket-aligned index); the value
  // is drawn from a closed set, never from user input.
  const unit = bucket === 'day' ? 'day' : 'hour';
  const step = bucket === 'day' ? '1 day' : '1 hour';

  const raw = (await db.execute(sql`
    WITH filtered AS (
      SELECT date_trunc(${unit}, u.occurred_at) AS bucket,
             u.input_tokens,
             u.output_tokens,
             u.cache_read_tokens,
             u.cost_customer_usd,
             u.cost_upstream_usd
        FROM usage_records u
       WHERE ${where}
    )
    SELECT gs AS bucket,
           count(f.bucket)::int                          AS requests,
           coalesce(sum(f.input_tokens), 0)::bigint      AS input_tokens,
           coalesce(sum(f.output_tokens), 0)::bigint     AS output_tokens,
           coalesce(sum(f.cache_read_tokens), 0)::bigint AS cache_read_tokens,
           coalesce(sum(f.cost_customer_usd), 0)         AS cost_customer,
           coalesce(sum(f.cost_upstream_usd), 0)         AS cost_upstream
      FROM generate_series(${from.toISOString()}::timestamptz,
                           ${to.toISOString()}::timestamptz,
                           ${step}::interval) AS gs
      LEFT JOIN filtered f ON f.bucket = gs
     GROUP BY gs
     ORDER BY gs
  `)) as unknown as {
    bucket: Date | string;
    requests: number;
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens: string;
    cost_customer: string;
    cost_upstream: string;
  }[];

  const points: UsageSeriesPoint[] = raw.map((r) => ({
    bucket:
      r.bucket instanceof Date
        ? r.bucket.toISOString()
        : new Date(String(r.bucket)).toISOString(),
    requests: Number(r.requests ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cacheReadTokens: Number(r.cache_read_tokens ?? 0),
    costCustomerUsd: Number(r.cost_customer ?? 0),
    costUpstreamUsd: Number(r.cost_upstream ?? 0),
  }));

  return {
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    points,
    totals: points.reduce(
      (acc, p) => ({
        requests: acc.requests + p.requests,
        inputTokens: acc.inputTokens + p.inputTokens,
        outputTokens: acc.outputTokens + p.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + p.cacheReadTokens,
        costCustomerUsd: acc.costCustomerUsd + p.costCustomerUsd,
        costUpstreamUsd: acc.costUpstreamUsd + p.costUpstreamUsd,
      }),
      {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costCustomerUsd: 0,
        costUpstreamUsd: 0,
      },
    ),
  };
}
