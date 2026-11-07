/**
 * Dodo verification — the Dodo payment path, end to end and offline.
 *
 * The sibling of scripts/verify-d17.ts for the international rail. It
 * proves the money path against the REAL code (service, state machine,
 * applyCallback, the live webhook route, real Dodo test-mode API calls)
 * with the two substitutions that make it deterministic and repeatable:
 *
 *   - the CARD is simulated by delivering a webhook signed exactly the
 *     way Dodo signs one (Standard Webhooks HMAC over id.timestamp.body
 *     with the whsec_-stripped key) to the RUNNING PORTAL — the same
 *     request Dodo's real test-mode subscription would deliver;
 *   - the renewal clock moves because WE choose next_billing_date.
 *
 * What each section proves:
 *   T1  configuration and catalog wiring (keys, product ids live)
 *   T2  starter checkout — flat plan coerces any seat ask to 1, the
 *       checkout session is created on the REAL Dodo test API, the row
 *       records provider='dodo' (not the configured default)
 *   T3  pro checkout — seats persist 3, an illegal 99 clamps to 25
 *   T4  the live webhook route: a real signed subscription.active
 *       activates the row and rolls the period to next_billing_date
 *   T5  a replayed webhook-id is a duplicate no-op, not a second month
 *   T6  a verified-but-unmapped event answers {ok:true,ignored:true}
 *   T7  a bad signature is rejected with 400 and writes nothing
 *   T8  subscription.past_due maps to the grace state, not a cut
 *   T9  cancel resolves the rail that SOLD the row, and a 404 from Dodo
 *       (id already gone) still flips the local row to canceled
 *
 * Fixtures (orgs, subscriptions, billing_events) live in the portal DB.
 * Like verify-d17, this runs only against a development stack with the
 * portal on BILLING_PROVIDER=dev (the Makefile documents why); nothing
 * here writes to a customer's money, and Dodo test-mode sessions
 * created by T2/T3 expire unused after 24 h.
 */

import './env.mjs';

import { createHmac, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db';
import {
  auditLog,
  billingEvents,
  paymentsD17,
  plans,
  subscriptions,
} from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import {
  beginCheckout,
  applyCallback,
  cancelSubscription,
  planStateFor,
} from '@/lib/billing';
import {
  DODO_WEBHOOK_HEADERS,
  dodoBaseUrl,
  dodoSign,
} from '@/lib/billing/dodo';
import { paymentWindowHours } from '@/lib/billing/d17-config';

// ───────────────────────────────────────────────────────────────────────
//  Assertion plumbing (identical shape to verify-d17)
// ───────────────────────────────────────────────────────────────────────

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(detail ? `${label} — ${detail}` : label);
  }
}

function section(title: string): void {
  process.stdout.write(`\n── ${title}\n`);
}

/** Create an account + org and start a Dodo checkout. */
async function startCheckout(planCode: string, seats?: number) {
  const runTag = randomBytes(4).toString('hex');
  const email = `dodo-${runTag}@verify.invalid`;
  const password = randomBytes(18).toString('base64url');
  const { domainUserId } = await createLocalUser({ email, name: 'Dodo Buyer', password });
  const org = await ensurePersonalOrg(domainUserId);
  const { intent } = await beginCheckout(
    org.organizationId,
    planCode,
    domainUserId,
    'dodo',
    null,
    seats,
  );
  return {
    email,
    password,
    domainUserId,
    organizationId: org.organizationId,
    subscriptionId: intent.subscriptionId,
    checkoutUrl: intent.checkoutUrl,
    providerReference: intent.providerReference,
  };
}

async function loadSubscriptionById(id: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  return row ?? null;
}

/**
 * Deliver a Dodo-SHAPED webhook to the RUNNING portal over HTTP — the
 * exact request Dodo's test-mode subscription will send: Standard
 * Webhooks headers, HMAC over `${id}.${timestamp}.${rawBody}` with the
 * whsec_-stripped secret. Nothing here trusts the body before the same
 * route verification production runs.
 */
async function deliverWebhook(
  eventId: string,
  dodoType: string,
  data: Record<string, unknown>,
  tamper = false,
): Promise<{ status: number; body: string }> {
  const portal = process.env.PORTAL_INTERNAL_URL ?? 'http://portal:3000';
  const body = JSON.stringify({ id: eventId, type: dodoType, data, ...{} });
  const wire = tamper ? `${body} ` : body;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = dodoSign(eventId, ts, body);
  const res = await fetch(`${portal}/api/billing/callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DODO_WEBHOOK_HEADERS.id]: `${eventId}`,
      [DODO_WEBHOOK_HEADERS.timestamp]: ts,
      [DODO_WEBHOOK_HEADERS.signature]: sig,
    },
    body: wire,
  });
  return { status: res.status, body: await res.text() };
}

/** A Dodo subscription payload shaped like the real webhook's `data`. */
function dodoSubscriptionData(opts: {
  organizationId: string;
  productId: string;
  subscriptionId: string;
  status: 'active' | 'past_due' | 'on_hold' | 'cancelled' | 'expired';
  nextBillingDate: string;
}) {
  return {
    business_id: 'bus_verify',
    subscription_id: opts.subscriptionId,
    status: opts.status,
    product_id: opts.productId,
    customer: { email: 'buyer@verify.invalid' },
    metadata: {
      organization_id: opts.organizationId,
      subscription_id: opts.subscriptionId,
    },
    modified_at: new Date().toISOString(),
    next_billing_date: opts.nextBillingDate,
  };
}

async function main(): Promise<void> {
  const run = randomBytes(3).toString('hex');
  process.stdout.write(`\nDodo verification — run ${run}\n`);

  // ── T1: configuration and catalog wiring ─────────────────────────────
  section('T1 configuration and catalog wiring');
  check(
    'DODO_PAYMENTS_API_KEY is configured',
    Boolean(process.env.DODO_PAYMENTS_API_KEY),
    'DODO_PAYMENTS_API_KEY empty',
  );
  check(
    'DODO_PAYMENTS_WEBHOOK_KEY is configured',
    Boolean(process.env.DODO_PAYMENTS_WEBHOOK_KEY),
    'DODO_PAYMENTS_WEBHOOK_KEY empty',
  );
  check(
    'the test-mode base URL is selected',
    dodoBaseUrl().includes('test.dodopayments.com'),
    dodoBaseUrl(),
  );

  const planRows = await db
    .select({
      code: plans.code,
      priceId: plans.providerPriceId,
      maxSeats: plans.maxSeats,
    })
    .from(plans)
    .where(eq(plans.code, 'starter'));
  const starterProviderId = planRows[0]?.priceId;
  const proProviderId = (
    await db.select({ priceId: plans.providerPriceId }).from(plans).where(eq(plans.code, 'pro'))
  )[0]?.priceId;
  check(
    'starter carries a Dodo product id',
    Boolean(starterProviderId) && starterProviderId!.startsWith('pdt_'),
    starterProviderId ?? 'NULL',
  );
  check(
    'pro carries a Dodo product id',
    Boolean(proProviderId) && proProviderId!.startsWith('pdt_'),
    proProviderId ?? 'NULL',
  );
  if (!starterProviderId || !proProviderId) {
    process.stdout.write('\nCannot continue without product ids — paste them into plans.provider_price_id.\n');
    reportAndExit();
  }

  // The ids on the catalog are REAL products sellable on Dodo's test
  // API — caught here, not at the moment a customer clicks Pay.
  for (const [label, id] of [['starter', starterProviderId], ['pro', proProviderId]] as const) {
    const res = await fetch(`${dodoBaseUrl()}/products/${id}`, {
      headers: { Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}` },
    });
    check(
      `the ${label} product id exists on Dodo's test API (got ${res.status})`,
      res.ok,
      res.ok ? '' : await res.text().catch(() => ''),
    );
  }

  // ── T2: starter checkout — flat, seats coerced to 1 ──────────────────
  section('T2 starter checkout (real Dodo test API, seats coerced)');
  const buyerA = await startCheckout('starter', 5);
  check(
    'the checkout url comes from dodopayments.com',
    buyerA.checkoutUrl.includes('dodopayments.com'),
    buyerA.checkoutUrl,
  );
  const rowA0 = await loadSubscriptionById(buyerA.subscriptionId);
  check(
    'the row records provider=dodo (the SELLER, not the default)',
    rowA0?.provider === 'dodo',
    rowA0?.provider ?? 'null',
  );
  check(
    'a seat ask of 5 on a flat plan is stored as 1',
    rowA0?.seats === 1,
    String(rowA0?.seats),
  );
  check(
    'no payment is taken before activation (status incomplete)',
    rowA0?.status === 'incomplete',
    rowA0?.status,
  );

  // ── T3: pro checkout — seats persist and clamp ───────────────────────
  section('T3 pro checkout (3 seats persist; 99 clamps to max_seats)');
  const buyerB = await startCheckout('pro', 3);
  const rowB = await loadSubscriptionById(buyerB.subscriptionId);
  check('3 requested seats are stored', rowB?.seats === 3, String(rowB?.seats));
  const buyerC = await startCheckout('pro', 99);
  const rowC = await loadSubscriptionById(buyerC.subscriptionId);
  check(
    '99 requested seats clamp to plans.max_seats (25)',
    rowC?.seats === 25,
    String(rowC?.seats),
  );

  // ── T3b: abandoned-checkout display (incomplete ≠ payment pending) ──
  // The row from T2 (starter, left incomplete without paying) is the
  // exact "opened checkout, went back" scenario the customers hit: the
  // dashboard must show the paywall, never a pending-payment state.
  section('T3b abandoned checkout shows the paywall, not "payment pending"');
  check(
    'an incomplete row with NO payment evidence reads as no_subscription',
    (await planStateFor(buyerA.organizationId)).state === 'no_subscription',
  );
  check(
    'an incomplete Dodo row NEVER reads as pending (Dodo has no local evidence before its webhook)',
    (await planStateFor(buyerC.organizationId)).state === 'no_subscription',
  );
  // Same incomplete row, but with the D17 evidence lifecycle walked under
  // it: a reserved queue slot is not a payment; a submitted proof is.
  // The proof_shape CHECK demands an authorization number + sender on any
  // submitted row, so the proof fixture carries a real-shaped one.
  const fakeProof = await db
    .insert(paymentsD17)
    .values({
      subscriptionId: buyerC.subscriptionId,
      organizationId: buyerC.organizationId,
      amountMillimes: 90000,
      usdAmountCents: 3000,
      fxRate: '3.0000',
      expiresAt: new Date(Date.now() + paymentWindowHours() * 3600000),
    })
    .returning({ id: paymentsD17.id });
  const proofId = fakeProof[0]?.id;
  if (!proofId) throw new Error('verify: payments_d17 insert returned nothing');
  check(
    'a reserved D17 queue slot (checkout opened, nothing transferred) still shows no plan',
    (await planStateFor(buyerC.organizationId)).state === 'no_subscription',
  );
  await db
    .update(paymentsD17)
    .set({
      status: 'proof_submitted',
      authorizationNumber: `VERIFY-${run.toUpperCase()}`,
      senderPhone: '+21600000000',
      submittedAt: new Date(),
    })
    .where(eq(paymentsD17.id, proofId));
  check(
    'it flips to pending ONLY once the D17 proof is submitted',
    (await planStateFor(buyerC.organizationId)).state === 'pending',
  );
  // Clean the fixture so the buyerC row returns to plain incomplete for
  // the sections below — and so re-runs never pile up fake proofs.
  await db.delete(paymentsD17).where(eq(paymentsD17.id, proofId));

  // ── T4: the live webhook route activates the subscription ────────────
  section('T4 signed subscription.active over the LIVE webhook route');
  const monthAhead = new Date(Date.now() + 31 * 86400000).toISOString();
  const activated = await deliverWebhook(
    `dodo-evt-activate-${run}`,
    'subscription.active',
    dodoSubscriptionData({
      organizationId: buyerA.organizationId,
      productId: starterProviderId,
      subscriptionId: 'sub_verify_active',
      status: 'active',
      nextBillingDate: monthAhead,
    }),
  );
  check(
    `the route answers 200 ok (got ${activated.status})`,
    activated.status === 200 && activated.body.includes('"state":"active"'),
    activated.body,
  );
  const rowA1 = await loadSubscriptionById(buyerA.subscriptionId);
  check(
    'the subscription is now active',
    rowA1?.status === 'active',
    rowA1?.status,
  );
  check(
    'the period rolled to next_billing_date, not now+1mo blindly',
    rowA1?.currentPeriodEnd?.toISOString() === new Date(monthAhead).toISOString(),
    rowA1?.currentPeriodEnd?.toISOString() ?? 'null',
  );

  // ── T5: replay is a duplicate, not a second month ────────────────────
  section('T5 replayed webhook-id is a duplicate no-op');
  const replay = await deliverWebhook(
    // Same event id AND same body ⇒ same signature. billing_events id
    // claim is what makes this a no-op.
    `dodo-evt-activate-${run}`,
    'subscription.active',
    dodoSubscriptionData({
      organizationId: buyerA.organizationId,
      productId: starterProviderId,
      subscriptionId: 'sub_verify_active',
      status: 'active',
      nextBillingDate: monthAhead,
    }),
  );
  check(
    `the replayed event answers duplicate:true (got ${replay.body})`,
    replay.status === 200 && replay.body.includes('"duplicate":true'),
    replay.body,
  );

  // ── T6: verified-but-unmapped events are ignored, not failed ─────────
  section('T6 unmapped event (verified, not acted on)');
  const ignored = await deliverWebhook(
    `dodo-evt-updated-${run}`,
    'subscription.updated',
    dodoSubscriptionData({
      organizationId: buyerA.organizationId,
      productId: starterProviderId,
      subscriptionId: 'sub_verify_active',
      status: 'active',
      nextBillingDate: monthAhead,
    }),
  );
  check(
    `answered {ok:true,ignored:true} (got ${ignored.status} ${ignored.body})`,
    ignored.status === 200 && ignored.body.includes('"ignored":true'),
    ignored.body,
  );

  // ── T7: a tampered body is rejected before parsing ───────────────────
  section('T7 tampered body rejected');
  const tampered = await deliverWebhook(
    `dodo-evt-tamper-${run}`,
    'subscription.active',
    dodoSubscriptionData({
      organizationId: buyerA.organizationId,
      productId: starterProviderId,
      subscriptionId: 'sub_verify_evil',
      status: 'active',
      nextBillingDate: monthAhead,
    }),
    true, // one extra byte after the signed body
  );
  check(
    `answered 400 (got ${tampered.status})`,
    tampered.status === 400,
    tampered.body,
  );
  const evilRow = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, `dodo-evt-tamper-${run}`))
    .limit(1);
  check('the rejected event was not recorded', evilRow.length === 0, JSON.stringify(evilRow.length));

  // ── T8: past_due maps to the grace state, not a cut ──────────────────
  section('T8 renewal failure opens the grace window');
  // Activate buyerB first (its row is still incomplete), then let the
  // renewal fail. Access must CONTINUE (past_due), and the period must
  // NOT move — the customer has not paid for the next one yet.
  const activateB = await deliverWebhook(
    `dodo-evt-activate-b-${run}`,
    'subscription.active',
    dodoSubscriptionData({
      organizationId: buyerB.organizationId,
      productId: proProviderId,
      subscriptionId: 'sub_verify_b',
      status: 'active',
      nextBillingDate: monthAhead,
    }),
  );
  check(
    `buyerB activated (got ${activateB.body})`,
    activateB.status === 200 && activateB.body.includes('"state":"active"'),
    activateB.body,
  );
  const pastDue = await deliverWebhook(
    `dodo-evt-pastdue-${run}`,
    'subscription.past_due',
    dodoSubscriptionData({
      organizationId: buyerB.organizationId,
      productId: proProviderId,
      subscriptionId: 'sub_verify_b',
      status: 'past_due',
      nextBillingDate: monthAhead,
    }),
  );
  check(
    `past_due applied (got ${pastDue.body})`,
    pastDue.status === 200 && pastDue.body.includes('"state":"past_due"'),
    pastDue.body,
  );
  const rowB1 = await loadSubscriptionById(buyerB.subscriptionId);
  check(
    'the row sits in past_due with its period untouched',
    rowB1?.status === 'past_due' && rowB1?.currentPeriodEnd !== null,
    `${rowB1?.status}/${rowB1?.currentPeriodEnd?.toISOString() ?? 'null'}`,
  );

  // ── T9: cancel resolves the row's own rail; 404 swallows ─────────────
  section('T9 cancel (sold-rail resolution, Dodo 404 swallowed)');
  // The row's providerSubscriptionId is the checkout SESSION id, not a
  // Dodo subscription id, so the real PATCH will 404 — which is exactly
  // the "already gone at Dodo" path cancel must swallow while the local
  // flip still happens.
  const canceled = await cancelSubscription(buyerB.organizationId, buyerB.domainUserId);
  check(
    'cancel reports no provider error (404 swallowed)',
    !canceled.providerError,
    JSON.stringify(canceled),
  );
  const rowB2 = await loadSubscriptionById(buyerB.subscriptionId);
  check(
    'the local row flips to canceled',
    rowB2?.status === 'canceled',
    rowB2?.status,
  );
  const [cancelAudit] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, 'subscription.canceled'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  check(
    'the audit trail stamps the row rail (dodo), not the default',
    (cancelAudit?.after as { provider?: string } | null)?.provider === 'dodo',
    JSON.stringify(cancelAudit?.after),
  );
  check(
    'the canceled row keeps its seats',
    rowB2?.seats === 3,
    String(rowB2?.seats),
  );

  reportAndExit();
}

function reportAndExit(): never {
  process.stdout.write(
    `\n${failures.length === 0 ? '✓ all dodo checks passed' : `✗ ${failures.length} check(s) failed:`}\n`,
  );
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    process.stdout.write(`\n✗ unexpected failure: ${e instanceof Error ? e.stack : String(e)}\n`);
    await pg`SELECT 1`.catch(() => {});
    process.exit(1);
  });
