/**
 * D17 admin verification — the human in the loop.
 *
 * This is what stands in for the webhook D17 does not have. The rules:
 *
 *   IDEMPOTENT APPROVAL. `approveD17Payment` routes through the SAME
 *   `applyCallback()` every other provider uses, with the event id
 *   `d17:<paymentId>:approved`. billing_events dedupes on that id, so a
 *   double click, a retried request, or two admins racing on the same
 *   payment fulfil exactly once. The payment row's own status guard is
 *   the second belt.
 *
 *   REJECT NEEDS A REASON. The customer is told why and may resubmit
 *   once; a second rejection is final and routes to support. "Once" is
 *   enforced by counting `d17.rejected` audit rows for the payment.
 *
 *   STAFF ONLY. Every function takes the staff id that acted and writes
 *   it to the payment row and the audit log.
 */

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  organizationMembers,
  organizations,
  paymentsD17,
  plans,
  subscriptions,
  users,
} from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { applyCallback, type ProviderEvent } from '@/lib/billing';
import { d17EmailTemplates } from '@/lib/email/d17-templates';
import { sendEmail } from '@/lib/email';
import { log } from '@/lib/log';
import { formatTndMillimes } from './d17-config';

export interface D17QueueRow {
  paymentId: string;
  subscriptionId: string;
  organizationName: string;
  planCode: string;
  amountMillimes: number;
  amount: string;
  authorizationNumber: string;
  senderPhone: string | null;
  screenshotPath: string | null;
  status: string;
  submittedAt: string | null;
  expiresAt: string;
  flaggedReview: boolean;
  rejectReason: string | null;
  rejections: number;
}

/**
 * The verification queue, newest submission first.
 *
 * Includes rejected/paid for the shift view (an admin wants to see what
 * they just did), so the caller filters by what it renders.
 */
export async function listD17Queue(
  statuses: string[] = ['proof_submitted'],
): Promise<D17QueueRow[]> {
  const rows = await db
    .select({
      paymentId: paymentsD17.id,
      subscriptionId: paymentsD17.subscriptionId,
      organizationName: organizations.name,
      planCode: plans.code,
      amountMillimes: paymentsD17.amountMillimes,
      authorizationNumber: paymentsD17.authorizationNumber,
      senderPhone: paymentsD17.senderPhone,
      screenshotPath: paymentsD17.screenshotPath,
      status: paymentsD17.status,
      submittedAt: paymentsD17.submittedAt,
      expiresAt: paymentsD17.expiresAt,
      flaggedReview: paymentsD17.flaggedReview,
      rejectReason: paymentsD17.rejectReason,
    })
    .from(paymentsD17)
    .innerJoin(organizations, eq(organizations.id, paymentsD17.organizationId))
    .innerJoin(subscriptions, eq(subscriptions.id, paymentsD17.subscriptionId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(paymentsD17.status, statuses as never))
    .orderBy(desc(paymentsD17.submittedAt))
    .limit(200);

  // Rejections so far (the "resubmit once" budget).
  const ids = rows.map((r) => r.paymentId);
  const rejectionCounts = new Map<string, number>();
  if (ids.length) {
    const counts = (await db.execute(sql`
      SELECT target_id, count(*)::int AS n
        FROM audit_log
       WHERE action = 'd17.rejected'
         AND target_type = 'payment_d17'
         AND target_id = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::text[]`)})
       GROUP BY target_id
    `)) as unknown as { target_id: string; n: number }[];
    for (const c of counts) rejectionCounts.set(c.target_id, Number(c.n));
  }

  return rows.map((r) => ({
    paymentId: r.paymentId,
    subscriptionId: r.subscriptionId,
    organizationName: r.organizationName,
    planCode: r.planCode,
    amountMillimes: r.amountMillimes,
    amount: formatTndMillimes(r.amountMillimes),
    authorizationNumber: r.authorizationNumber ?? '',
    senderPhone: r.senderPhone,
    screenshotPath: r.screenshotPath,
    status: r.status,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
    flaggedReview: r.flaggedReview,
    rejectReason: r.rejectReason,
    rejections: rejectionCounts.get(r.paymentId) ?? 0,
  }));
}

export interface AdminActionResult {
  ok: boolean;
  alreadyApplied?: boolean;
  error?: string;
}

/**
 * Approve a proof. Idempotent by construction:
 *   - a `paid` row is returned as already-applied without touching
 *     anything (so a double click is a no-op), and
 *   - the activation itself goes through applyCallback, whose
 *     billing_events insert dedupes on `d17:<id>:approved` even if two
 *     approvals race before the row is updated.
 */
export async function approveD17Payment(
  staffId: string,
  paymentId: string,
): Promise<AdminActionResult> {
  const payment = await db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.id, paymentId),
  });
  if (!payment) return { ok: false, error: 'not_found' };
  if (payment.status === 'paid') return { ok: true, alreadyApplied: true };
  if (payment.status !== 'proof_submitted') {
    return { ok: false, error: 'not_submitted' };
  }

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, payment.subscriptionId),
  });
  const plan = sub
    ? await db.query.plans.findFirst({ where: eq(plans.id, sub.planId) })
    : null;

  // The activation. Event id is the idempotency key.
  const event: ProviderEvent = {
    id: `d17:${payment.id}:approved`,
    kind: 'subscription.activated',
    providerReference: `d17-${payment.id}`,
    organizationId: payment.organizationId,
    planCode: plan?.code,
  };

  try {
    const applied = await applyCallback(event);
    if (applied.duplicate) {
      // Another approval already activated this subscription.
      log.info('d17: approval was a duplicate', { paymentId, staffId });
    }
  } catch (e) {
    log.error('d17: approval failed', {
      paymentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'activation_failed' };
  }

  await db
    .update(paymentsD17)
    .set({
      status: 'paid',
      verifiedAt: new Date(),
      verifiedBy: staffId,
      updatedAt: new Date(),
    })
    .where(and(eq(paymentsD17.id, paymentId), ne(paymentsD17.status, 'paid')));

  // Correct this payment's period to the ACTUAL rolled subscription
  // period. At begin() time the period was provisional (old end or now);
  // approval is when the real start/end are known. Without this the
  // history would show the guess, not the period the customer paid for.
  const rolled = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, payment.subscriptionId),
  });
  if (rolled?.currentPeriodStart && rolled?.currentPeriodEnd) {
    await db
      .update(paymentsD17)
      .set({
        periodStart: rolled.currentPeriodStart,
        periodEnd: rolled.currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(paymentsD17.id, paymentId));
  }

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: payment.organizationId,
    action: 'd17.approved',
    targetType: 'payment_d17',
    targetId: payment.id,
    after: { planCode: plan?.code ?? null, authorizationNumber: payment.authorizationNumber },
  });

  // Customer confirmation.
  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, payment.organizationId),
      eq(organizationMembers.role, 'owner'),
    ),
  });
  if (membership && plan) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, membership.userId),
    });
    if (owner?.email) {
      const templates = d17EmailTemplates('fr');
      try {
        await sendEmail({
          to: owner.email,
          subject: templates.approvedSubject({
            plan: plan.name,
            amount: formatTndMillimes(payment.amountMillimes),
          }),
          text: templates.approvedBody({
            plan: plan.name,
            amount: formatTndMillimes(payment.amountMillimes),
          }),
        });
      } catch (e) {
        log.error('d17: approval email failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  log.info('d17: approved', { paymentId, staffId, organizationId: payment.organizationId });
  return { ok: true };
}

/**
 * Reject a proof with a reason. The customer is notified and may
 * resubmit once; a second rejection is final (counted from the audit
 * log) and the message says to contact support.
 */
export async function rejectD17Payment(
  staffId: string,
  paymentId: string,
  reason: string,
): Promise<AdminActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: 'reason_required' };
  if (trimmed.length > 500) return { ok: false, error: 'reason_too_long' };

  const payment = await db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.id, paymentId),
  });
  if (!payment) return { ok: false, error: 'not_found' };
  if (payment.status !== 'proof_submitted') return { ok: false, error: 'not_submitted' };

  const priorRejections = (await db.execute(sql`
    SELECT count(*)::int AS n
      FROM audit_log
     WHERE action = 'd17.rejected'
       AND target_type = 'payment_d17'
       AND target_id = ${payment.id}
  `)) as unknown as { n: number }[];
  const alreadyRejected = Number(priorRejections[0]?.n ?? 0) >= 1;

  await db
    .update(paymentsD17)
    .set({
      status: 'rejected',
      rejectReason: trimmed,
      verifiedAt: new Date(),
      verifiedBy: staffId,
      updatedAt: new Date(),
    })
    .where(eq(paymentsD17.id, payment.id));

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: payment.organizationId,
    action: 'd17.rejected',
    targetType: 'payment_d17',
    targetId: payment.id,
    after: { reason: trimmed, final: alreadyRejected },
  });

  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, payment.organizationId),
      eq(organizationMembers.role, 'owner'),
    ),
  });
  if (membership) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, membership.userId),
    });
    if (owner?.email) {
      const templates = d17EmailTemplates('fr');
      try {
        await sendEmail({
          to: owner.email,
          subject: templates.rejectedSubject({}),
          text: templates.rejectedBody({
            amount: formatTndMillimes(payment.amountMillimes),
            reason: alreadyRejected
              ? `${trimmed} — This proof was already rejected once; please contact support.`
              : trimmed,
          }),
        });
      } catch (e) {
        log.error('d17: rejection email failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  log.info('d17: rejected', { paymentId, staffId, final: alreadyRejected });
  return { ok: true };
}

/**
 * Reconciliation: approved totals per day, and the raw rows for CSV.
 * "Sum of approved vs D17 history" — the D17 side stays manual; this is
 * our side of that comparison.
 */
export async function d17Reconciliation(days = 30): Promise<{
  daily: { day: string; count: number; totalMillimes: number }[];
  totals: { count: number; totalMillimes: number };
}> {
  const rows = (await db.execute(sql`
    SELECT date_trunc('day', verified_at)::date::text AS day,
           count(*)::int                         AS n,
           sum(amount_millimes)::int             AS total
      FROM payments_d17
     WHERE status = 'paid'
       AND verified_at > now() - (${days} * interval '1 day')
     GROUP BY 1
     ORDER BY 1 DESC
  `)) as unknown as { day: string; n: number; total: number }[];

  const total = rows.reduce(
    (acc, r) => ({ count: acc.count + Number(r.n), totalMillimes: acc.totalMillimes + Number(r.total) }),
    { count: 0, totalMillimes: 0 },
  );

  return {
    daily: rows.map((r) => ({
      day: r.day,
      count: Number(r.n),
      totalMillimes: Number(r.total),
    })),
    totals: total,
  };
}

/** CSV rows for accounting — every paid D17 payment in the window. */
export async function d17PaymentsCsv(days = 365): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT p.id, o.name AS organization, pl.code AS plan,
           p.amount_millimes, p.usd_amount_cents, p.fx_rate,
           p.authorization_number, p.sender_phone,
           p.submitted_at, p.verified_at, p.status
      FROM payments_d17 p
      JOIN organizations o ON o.id = p.organization_id
      JOIN subscriptions s ON s.id = p.subscription_id
      JOIN plans pl ON pl.id = s.plan_id
     WHERE p.created_at > now() - (${days} * interval '1 day')
     ORDER BY p.created_at DESC
  `)) as unknown as {
    id: string;
    organization: string;
    plan: string;
    amount_millimes: number;
    usd_amount_cents: number;
    fx_rate: string;
    authorization_number: string;
    sender_phone: string;
    submitted_at: string | null;
    verified_at: string | null;
    status: string;
  }[];

  const header = [
    'id', 'organization', 'plan', 'amount_tnd', 'usd_cents', 'fx_rate',
    'authorization_number', 'sender_phone', 'submitted_at', 'verified_at', 'status',
  ];
  const escape = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        escape(r.organization),
        r.plan,
        (Number(r.amount_millimes) / 1000).toFixed(3),
        r.usd_amount_cents,
        r.fx_rate,
        escape(r.authorization_number),
        escape(r.sender_phone),
        escape(r.submitted_at),
        escape(r.verified_at),
        r.status,
      ].join(','),
    );
  }
  return lines.join('\n');
}
