/**
 * D17BillingProvider — manual payment via La Poste Tunisienne's D17.
 *
 * THERE IS NO D17 MERCHANT API. No payment intent, no redirect, no
 * webhook, no status polling. The customer transfers money inside the
 * D17 app and D17 shows them an authorization number; the merchant
 * confirms every transfer by hand in the app's transaction history.
 *
 * So this provider implements the BillingProvider seam with the parts
 * that do exist:
 *
 *   begin()   — creates the local payment row (pending_payment +
 *               expires_at) and returns a URL to OUR OWN instruction
 *               page. There is nothing to redirect to on D17's side.
 *   verify()  — always throws. There is no callback to verify. The
 *               equivalent step is the ADMIN APPROVAL in
 *               lib/billing/d17-admin.ts, which routes through the same
 *               idempotent applyCallback() as a webhook would — that is
 *               what keeps "approved once" true.
 *   cancel()  — nothing to cancel remotely; the row is local.
 *
 * begin() writes the payment row itself (rather than the service doing
 * it) because the amount depends on the plan price and the configured
 * USD→TND rate — a payment concern, not a subscription one.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { plans, paymentsD17, subscriptions } from '@/db/schema';
import { log } from '@/lib/log';
import {
  amountTndMillimes,
  d17ReceiverPhone,
  paymentDeadline,
  usdTndRate,
} from './d17-config';
import type {
  BeginCheckoutInput,
  BillingProvider,
  CheckoutIntent,
  ProviderEvent,
} from './types';

export const d17BillingProvider: BillingProvider = {
  name: 'd17',

  async begin(input: BeginCheckoutInput): Promise<CheckoutIntent> {
    if (!d17ReceiverPhone()) {
      // Refuse loudly rather than printing an empty recipient number on
      // the instruction page — the customer would transfer to nobody.
      throw new Error('D17_RECEIVER_PHONE is not configured.');
    }

    const plan = await db.query.plans.findFirst({
      where: eq(plans.code, input.planCode),
    });
    if (!plan) throw new Error(`d17: plan ${input.planCode} not found`);

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, input.subscriptionId),
    });
    if (!sub) throw new Error(`d17: subscription ${input.subscriptionId} not found`);

    const rate = usdTndRate();
    const millimes = amountTndMillimes(plan.priceCents, rate);
    const expiresAt = paymentDeadline();

    // Which period this payment covers. For a first purchase there is no
    // period yet — provisional now → now+1mo, corrected on approval. For a
    // renewal the payment covers the NEXT period: old end → old end+1mo,
    // or now → now+1mo if already lapsed. The approval corrects it to the
    // actual rolled period, so early renewal never loses overlap days.
    const now = new Date();
    const base = sub.currentPeriodEnd && sub.currentPeriodEnd > now
      ? sub.currentPeriodEnd
      : now;
    const periodStart = sub.currentPeriodStart ?? now;
    const periodEnd = new Date(base.getTime());
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    // At most one OPEN payment per subscription. A re-checkout while a
    // pending/proof/rejected row is still alive reuses it (fresh window,
    // same row) rather than piling up attempts that expire into phantom
    // history rows. Paid/expired rows are terminal — a new attempt after
    // them inserts a new row, which is what makes renewals and history
    // possible (0007).
    //
    // The partial unique index `payments_d17_one_open_idx` is the RACE-SAFE
    // backstop: two simultaneous checkouts both see no open row, both
    // insert, and the loser gets 23505. We then re-select and take the
    // update path, so the customer sees one payment, not two.
    const openFields = {
      amountMillimes: millimes,
      usdAmountCents: plan.priceCents,
      fxRate: String(rate),
      authorizationNumber: null,
      senderPhone: null,
      screenshotPath: null,
      status: 'pending_payment' as const,
      submittedAt: null,
      verifiedAt: null,
      verifiedBy: null,
      rejectReason: null,
      flaggedReview: false,
      expiresAt,
      periodStart,
      periodEnd,
      updatedAt: new Date(),
    };

    async function openRow() {
      return db.query.paymentsD17.findFirst({
        where: and(
          eq(paymentsD17.subscriptionId, input.subscriptionId),
          inArray(paymentsD17.status, ['pending_payment', 'proof_submitted', 'rejected'] as never),
        ),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
    }

    const existingOpen = await openRow();
    let payment = existingOpen
      ? (await db.update(paymentsD17).set(openFields).where(eq(paymentsD17.id, existingOpen.id)).returning())[0]
      : undefined;

    if (!payment) {
      try {
        payment = (
          await db
            .insert(paymentsD17)
            .values({
              subscriptionId: input.subscriptionId,
              organizationId: input.organizationId,
              amountMillimes: millimes,
              usdAmountCents: plan.priceCents,
              fxRate: String(rate),
              expiresAt,
              periodStart,
              periodEnd,
              currency: 'TND',
            })
            .returning()
        )[0];
      } catch (e) {
        // Unique violation on the one-open partial index: another request
        // won the insert. Re-read and update that row instead.
        if ((e as { code?: string }).code !== '23505') throw e;
        const raced = await openRow();
        if (!raced) throw e;
        payment = (
          await db.update(paymentsD17).set(openFields).where(eq(paymentsD17.id, raced.id)).returning()
        )[0];
      }
    }

    if (!payment) throw new Error('d17: could not create the payment row');

    const origin = (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    return {
      providerReference: `d17-${payment.id}`,
      // Our own instruction page — the customer never leaves the site
      // for the payment itself; the transfer happens inside the D17 app.
      checkoutUrl: `${origin}/checkout/d17/${input.subscriptionId}`,
      subscriptionId: input.subscriptionId,
      expiresAt: expiresAt.toISOString(),
    };
  },

  async verify(): Promise<ProviderEvent> {
    throw new Error(
      'D17 has no webhook: verification is the admin approval in lib/billing/d17-admin.ts.',
    );
  },

  async cancel(): Promise<void> {
    // Nothing on D17's side to cancel — the transfer, if it happened,
    // is confirmed by a human.
  },
};

/** Load the LATEST payment row for a subscription (the instruction page reads this).
 *
 * Newest-first by created_at, explicitly. Before 0007 there was exactly
 * one row per subscription so any lookup order worked; after 0007 a bare
 * findFirst with no orderBy returns an ARBITRARY prior period's row — a
 * renewing customer would see last month's "paid" while the current period
 * is unpaid. Every caller that renders "the payment" must use this, never
 * an unordered lookup.
 */
export async function loadD17Payment(subscriptionId: string) {
  return db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.subscriptionId, subscriptionId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

/** The latest OPEN payment (pending/proof/rejected), if any. Proof
 * submission must target this row, not just the latest row: after a
 * renewal the latest row may be a new pending_payment while an older
 * proof_submitted is still awaiting review, and filing proof against the
 * wrong row would orphan the transfer.
 */
export async function loadOpenD17Payment(subscriptionId: string, organizationId: string) {
  return db.query.paymentsD17.findFirst({
    where: and(
      eq(paymentsD17.subscriptionId, subscriptionId),
      eq(paymentsD17.organizationId, organizationId),
      inArray(paymentsD17.status, ['pending_payment', 'proof_submitted', 'rejected'] as never),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

/** Used by the proof path to find the payment that carries an auth number. */
export async function findPaymentByAuthNumber(authorizationNumber: string) {
  return db.query.paymentsD17.findFirst({
    where: and(
      eq(paymentsD17.authorizationNumber, authorizationNumber),
      ne(paymentsD17.status, 'expired'),
    ),
  });
}

/** The subscriptions row, for the instruction page header. */
export async function loadSubscriptionForD17(subscriptionId: string) {
  return db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
}

/** A short, human-referenceable id for screenshots and logs. */
export function screenshotName(): string {
  return `${randomUUID()}.png`;
}

export { log as _log };
