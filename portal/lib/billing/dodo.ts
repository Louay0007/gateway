/**
 * DodoBillingProvider — the international rail.
 *
 * Dodo Payments is a Merchant of Record: it hosts the checkout, charges
 * the card, renews it, handles tax/VAT, dunning and chargebacks. Unlike
 * D17 there is nothing manual here — a customer is redirected to Dodo,
 * pays, and comes back to a subscription that is already live.
 *
 * The seam is unchanged. This file is the third implementation of
 * `BillingProvider` and nothing in the state machine, entitlements or
 * `billing_events` idempotency knows it exists.
 *
 * NO SDK. Two REST calls and one HMAC; the repo already hand-rolls HMAC
 * in lib/billing/dev.ts, and a dependency for this is not worth its
 * supply chain.
 *
 * WEBHOOKS follow the Standard Webhooks spec, which Dodo implements:
 *   webhook-id, webhook-timestamp, webhook-signature: "v1,<base64> ..."
 *   signed content = `${id}.${timestamp}.${rawBody}`
 *   key = base64-decoded secret (the "whsec_" prefix is not part of it)
 * Verified BEFORE parsing, always — see `verify` below.
 *
 * CUSTOMER EMAIL. Dodo requires one on the checkout session. Ours is the
 * org owner's, which is who a subscription belongs to.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers, plans, users } from '@/db/schema';
import { log } from '@/lib/log';
import type {
  BeginCheckoutInput,
  BillingProvider,
  CheckoutIntent,
  ProviderEvent,
  ProviderEventKind,
} from './types';

// ───────────────────────────────────────────────────────────────────────
//  Configuration — read at call time, never at import
// ───────────────────────────────────────────────────────────────────────

/** How long a Dodo checkout session stays usable. Dodo's own limit. */
const SESSION_HOURS = 24;

/** Standard Webhooks replay window. Older than this is refused. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export const DODO_WEBHOOK_HEADERS = {
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const;

function apiKey(): string {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) throw new Error('DODO_PAYMENTS_API_KEY is not configured.');
  return key;
}

/**
 * The webhook signing secret, already base64-decoded.
 *
 * Dodo hands out `whsec_<base64>`. The prefix is a label, not key
 * material; HMAC over the prefixed string verifies nothing and fails
 * with a perfectly valid signature, which is a confusing hour to lose.
 */
function webhookKey(): Buffer {
  const raw = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!raw) throw new Error('DODO_PAYMENTS_WEBHOOK_KEY is not configured.');
  const b64 = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) throw new Error('DODO_PAYMENTS_WEBHOOK_KEY is not valid base64.');
  return bytes;
}

export function dodoBaseUrl(): string {
  const env = (process.env.DODO_PAYMENTS_ENVIRONMENT ?? 'test_mode').toLowerCase();
  return env === 'live_mode'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';
}

// ───────────────────────────────────────────────────────────────────────
//  Signature — Standard Webhooks, hand-rolled
// ───────────────────────────────────────────────────────────────────────

/** One `v1,<base64>` entry for a raw body. Exported for the tests. */
export function dodoSign(
  id: string,
  timestamp: string,
  rawBody: string,
  key: Buffer = webhookKey(),
): string {
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

/**
 * True when ANY entry in the space-separated `webhook-signature` list
 * matches. The list exists so a sender can rotate secrets: one live
 * entry, one retiring entry, and both must be accepted during the
 * overlap.
 */
export function dodoVerifySignature(
  id: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
  key: Buffer = webhookKey(),
): boolean {
  const expected = dodoSign(id, timestamp, rawBody, key);
  const a = Buffer.from(expected, 'utf8');
  let matched = false;
  for (const entry of signatureHeader.split(' ')) {
    const b = Buffer.from(entry, 'utf8');
    // No early return: every entry is compared so the timing does not
    // reveal which one matched (or how many entries there were).
    if (a.length === b.length && timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

// ───────────────────────────────────────────────────────────────────────
//  Event mapping
// ───────────────────────────────────────────────────────────────────────

/**
 * Dodo event type → ours, or null for the many we deliberately ignore.
 *
 * `subscription.renewed` is the renewal signal, NOT `payment.succeeded`:
 * Dodo's docs are explicit that payment events fire for failed or
 * retried attempts too, while `renewed` means the period actually
 * extended. Using the payment event would grant access for money that
 * later bounces.
 */
export function dodoEventKind(type: string): ProviderEventKind | null {
  switch (type) {
    case 'subscription.active':
    case 'subscription.renewed':
      return 'subscription.activated';
    case 'subscription.past_due':
    case 'subscription.on_hold':
      return 'subscription.payment_failed';
    case 'subscription.cancelled':
    case 'subscription.expired':
    case 'subscription.failed':
      // `failed` is terminal at Dodo: the mandate could not be created,
      // the subscription cannot be reactivated, and a customer must
      // resubscribe. Mapping it to canceled cuts local access now
      // instead of leaving a subscription that will never renew.
      return 'subscription.canceled';
    default:
      return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
//  The provider
// ───────────────────────────────────────────────────────────────────────

interface DodoCheckoutResponse {
  session_id?: string;
  checkout_url?: string;
  [k: string]: unknown;
}

interface DodoWebhookBody {
  type?: string;
  data?: {
    subscription_id?: string;
    product_id?: string;
    next_billing_date?: string;
    metadata?: Record<string, string | undefined> | null;
    customer?: { email?: string } | null;
  };
}

async function dodoFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${dodoBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

export const dodoBillingProvider: BillingProvider = {
  name: 'dodo',

  async begin(input: BeginCheckoutInput): Promise<CheckoutIntent> {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.code, input.planCode),
    });
    if (!plan) throw new Error(`dodo: plan ${input.planCode} not found`);

    // The one thing an operator must configure in the Dodo dashboard.
    // Failing silently here means the customer is charged for nothing.
    if (!plan.providerPriceId) {
      throw new Error(
        `dodo: plan ${plan.code} has no provider_price_id — create the product in Dodo and paste its id into plans.provider_price_id.`,
      );
    }

    const owner = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.role, 'owner'),
      ),
    });
    const customer = owner
      ? await db.query.users.findFirst({ where: eq(users.id, owner.userId) })
      : null;

    const seats = Math.max(1, Math.trunc(input.seats || 1));

    // Checkout sessions expect an absolute return_url for the hosted
    // redirect back to us. safeReturnPath deliberately yields a
    // same-site relative path for our own pages, so resolve it against
    // APP_URL here rather than changing that rule everywhere.
    const origin = (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const returnUrl = input.returnUrl.startsWith('http')
      ? input.returnUrl
      : `${origin}${input.returnUrl.startsWith('/') ? '' : '/'}${input.returnUrl}`;

    // `metadata` is the ONLY trustworthy way a webhook learns which org
    // paid: Dodo echoes it back on every subscription event, and nobody
    // outside this call can set it.
    //
    // billing_currency=USD locks the subscription currency at creation.
    // Dodo's docs warn adaptive currency is otherwise detected from the
    // customer's IP and then fixed for the life of the subscription.
    const res = await dodoFetch('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        product_cart: [{ product_id: plan.providerPriceId, quantity: seats }],
        ...(customer?.email ? { customer: { email: customer.email } } : {}),
        billing_currency: 'USD',
        return_url: returnUrl,
        metadata: {
          organization_id: input.organizationId,
          subscription_id: input.subscriptionId,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`dodo: checkout failed (${res.status}) ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as DodoCheckoutResponse;
    if (!body.checkout_url || !body.session_id) {
      throw new Error('dodo: checkout response had no session_id/checkout_url');
    }

    return {
      providerReference: body.session_id,
      checkoutUrl: body.checkout_url,
      subscriptionId: input.subscriptionId,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString(),
    };
  },

  async verify(rawBody: string, headers: Record<string, string | null>): Promise<ProviderEvent | null> {
    const id = headers[DODO_WEBHOOK_HEADERS.id];
    const ts = headers[DODO_WEBHOOK_HEADERS.timestamp];
    const sig = headers[DODO_WEBHOOK_HEADERS.signature];
    if (!id || !ts || !sig) {
      throw new Error('dodo: missing webhook-id/webhook-timestamp/webhook-signature');
    }

    // Replay window. A captured payload replayed an hour later is refused
    // even though its signature is genuine.
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_SECONDS) {
      throw new Error('dodo: webhook timestamp outside the replay window');
    }

    if (!dodoVerifySignature(id, ts, rawBody, sig)) {
      throw new Error('dodo: webhook signature mismatch');
    }

    // Only now is the body trustworthy.
    const body = JSON.parse(rawBody) as DodoWebhookBody;
    const kind = dodoEventKind(body.type ?? '');
    if (!kind) {
      // Verified, deliberately not acted on. `null` tells the route to
      // answer 200 so Dodo stops retrying; it does NOT record an event.
      return null;
    }

    const sub = body.data;
    const organizationId = sub?.metadata?.organization_id;
    if (!organizationId) {
      // Unattributable money must never be silently accepted.
      throw new Error('dodo: webhook carried no metadata.organization_id');
    }

    const plan = sub?.product_id
      ? await db.query.plans.findFirst({ where: eq(plans.providerPriceId, sub.product_id) })
      : null;

    if (!plan) {
      log.warn('dodo: webhook for an unknown product', { productId: sub?.product_id ?? null });
    }

    return {
      // Under Standard Webhooks the event id IS the dedupe key, and Dodo
      // retries with the same id — exactly what billing_events wants.
      id,
      kind,
      providerReference: sub?.subscription_id ? `dodo-${sub.subscription_id}` : 'dodo-unknown',
      organizationId,
      planCode: plan?.code,
      periodEnd: sub?.next_billing_date,
      failureReason: kind === 'subscription.payment_failed' ? body.type : undefined,
    };
  },

  async cancel(input: {
    organizationId: string;
    providerSubscriptionId: string | null;
  }): Promise<void> {
    if (!input.providerSubscriptionId) return;
    const id = input.providerSubscriptionId.startsWith('dodo-')
      ? input.providerSubscriptionId.slice('dodo-'.length)
      : input.providerSubscriptionId;

    const res = await dodoFetch(`/subscriptions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ cancel_at_next_billing_date: true }),
    });

    // 404 = already gone at Dodo. The local row still flips, which is the
    // outcome the customer asked for.
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      throw new Error(`dodo: cancel failed (${res.status}) ${detail.slice(0, 300)}`);
    }
  },
};
