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
import { and, eq, ne } from 'drizzle-orm';
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

    const rate = usdTndRate();
    const millimes = amountTndMillimes(plan.priceCents, rate);
    const expiresAt = paymentDeadline();

    // One payment row per subscription for its lifetime: a re-checkout
    // resets the same row (new amount, new window, back to
    // pending_payment) rather than piling up attempts.
    const existing = await db.query.paymentsD17.findFirst({
      where: eq(paymentsD17.subscriptionId, input.subscriptionId),
    });

    const payment = existing
      ? (
          await db
            .update(paymentsD17)
            .set({
              amountMillimes: millimes,
              usdAmountCents: plan.priceCents,
              fxRate: String(rate),
              authorizationNumber: null,
              senderPhone: null,
              screenshotPath: null,
              status: 'pending_payment',
              submittedAt: null,
              verifiedAt: null,
              verifiedBy: null,
              rejectReason: null,
              flaggedReview: false,
              expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(paymentsD17.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(paymentsD17)
            .values({
              subscriptionId: input.subscriptionId,
              organizationId: input.organizationId,
              amountMillimes: millimes,
              usdAmountCents: plan.priceCents,
              fxRate: String(rate),
              expiresAt,
              currency: 'TND',
            })
            .returning()
        )[0];

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

/** Load the payment row for a subscription (the instruction page reads this). */
export async function loadD17Payment(subscriptionId: string) {
  return db.query.paymentsD17.findFirst({
    where: and(
      eq(paymentsD17.subscriptionId, subscriptionId),
      // A re-checkout replaces the row; there is only ever one per sub.
    ),
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
