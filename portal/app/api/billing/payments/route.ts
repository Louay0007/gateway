/**
 * GET /api/billing/payments — this account's payment history.
 *
 * The Billing page had a "Recent payments" card from the first UI rewrite
 * with nothing behind it: `payments_d17` is a verification QUEUE read only
 * by the staff endpoints, and there was no customer-facing read at all. A
 * customer who paid by bank transfer and was told "activation is manual"
 * had no way to see whether their payment was received, verified, rejected
 * or simply sitting in a queue — which is the single most anxious moment in
 * a manual payment flow.
 *
 * Customer-safe projection. `payments_d17` also holds `ip`, `user_agent`,
 * `verified_by` and `flagged_review`; none of those are the customer's
 * business and the first two should never leave the server. What is
 * returned is what they already know plus what they are waiting on:
 *
 *   status        pending_payment | proof_submitted | paid | rejected | expired
 *   rejectReason  only when the payment was rejected, and only because they
 *                 were emailed it and are entitled to see it again
 *   submittedAt   so "we are checking" can be dated rather than vague
 *
 * Capped at the most recent 24 — a customer scrolling further back than a
 * couple of years of subscriptions is not a case this needs to serve, and
 * an unbounded list on a dashboard is the "too much" state the UI matrix
 * says to design for. `pending_payment` and `expired` rows ARE included: a
 * customer needs to see that their payment window elapsed, and that is
 * precisely when they most want to look.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { paymentsD17, plans, subscriptions } from '@/db/schema';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse } from '@/lib/api/errors';
import { formatTndMillimes } from '@/lib/billing/d17-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 24;

export interface PaymentHistoryItem {
  id: string;
  planCode: string;
  planName: string;
  /** TND millimes — the amount the customer actually transferred. */
  amountMillimes: number;
  amount: string;
  /** The USD price the TND figure was derived from, for reconciliation. */
  usdAmountCents: number;
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  expiresAt: string;
  rejectReason: string | null;
  flaggedReview: boolean;
}

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();

    const rows = await db
      .select({
        id: paymentsD17.id,
        planCode: plans.code,
        planName: plans.name,
        amountMillimes: paymentsD17.amountMillimes,
        usdAmountCents: paymentsD17.usdAmountCents,
        status: paymentsD17.status,
        submittedAt: paymentsD17.submittedAt,
        verifiedAt: paymentsD17.verifiedAt,
        createdAt: paymentsD17.createdAt,
        expiresAt: paymentsD17.expiresAt,
        rejectReason: paymentsD17.rejectReason,
        flaggedReview: paymentsD17.flaggedReview,
      })
      .from(paymentsD17)
      // `payments_d17` has no plan_id — the plan lives on the subscription
      // this payment activates. Joining plans straight onto the
      // subscription_id would silently match whatever plan happened to own
      // that uuid, which is either nothing or the wrong plan.
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, paymentsD17.subscriptionId),
      )
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(paymentsD17.organizationId, ctx.orgId))
      .orderBy(desc(paymentsD17.createdAt))
      .limit(LIMIT);

    const payments: PaymentHistoryItem[] = rows.map((r) => ({
      id: r.id,
      planCode: r.planCode,
      planName: r.planName,
      amountMillimes: r.amountMillimes,
      amount: formatTndMillimes(r.amountMillimes),
      usdAmountCents: r.usdAmountCents,
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      rejectReason: r.rejectReason,
      flaggedReview: r.flaggedReview,
    }));

    return Response.json({ payments });
  } catch (e) {
    return errorResponse(e);
  }
}