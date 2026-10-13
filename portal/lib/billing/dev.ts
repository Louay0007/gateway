/**
 * DevBillingProvider — the lifecycle without a payment processor.
 *
 * WHY IT EXISTS. The payment provider is undecided, but the MVP has to
 * work end-to-end TODAY: signup → choose plan → active → key → usage →
 * upgrade → cancel. This provider runs every one of those paths for
 * real: a genuine local subscription row, a genuine signature-verified
 * callback, genuine idempotency in `billing_events`, genuine entitlement
 * sync. Only the money is fake.
 *
 * The flow:
 *   1. `begin()` hands back a URL on our own origin — a payment
 *      simulator page (Track B renders it) pre-signed for the
 *      subscription it activates.
 *   2. That page POSTs to `/api/billing/callback` with a JSON body
 *      signed the same way a provider signs its webhook: HMAC-SHA256
 *      over the RAW body, hex, in `x-billing-signature`, keyed by
 *      `BILLING_DEV_SECRET`.
 *   3. `verify()` recomputes that HMAC and rejects anything else.
 *
 * Because the signature scheme is documented and the secret is in the
 * environment, a test or the metering proof can drive the callback
 * without a browser — see `devSignBody` below, which exists so the
 * signing scheme itself stays in this one file.
 *
 * THIS PROVIDER NEVER SHIPS. It is selected by BILLING_PROVIDER=dev
 * (the local default) and must be unreachable in any environment where
 * real payments are expected.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BeginCheckoutInput,
  BillingProvider,
  CheckoutIntent,
  ProviderEvent,
  ProviderEventKind,
} from './types';

/** Header the dev provider signs callbacks with, mirroring a PSP. */
export const DEV_SIGNATURE_HEADER = 'x-billing-signature';

function secret(): string {
  const s = process.env.BILLING_DEV_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'BILLING_DEV_SECRET must be set (≥16 chars) to use the dev billing provider.',
    );
  }
  return s;
}

function appUrl(): string {
  return process.env.APP_URL ?? 'http://127.0.0.1:3000';
}

/** Sign a raw callback body. The single definition of the dev scheme. */
export function devSignBody(rawBody: string, key = secret()): string {
  return createHmac('sha256', key).update(rawBody, 'utf8').digest('hex');
}

/** The simulator page URL, pre-signed for the subscription it activates. */
export function devCheckoutUrl(subscriptionId: string, returnUrl: string): string {
  const sig = devSignBody(subscriptionId);
  const url = new URL('/billing/confirm', appUrl());
  url.searchParams.set('subscription', subscriptionId);
  url.searchParams.set('return', returnUrl);
  url.searchParams.set('sig', sig);
  return url.toString();
}

export const devBillingProvider: BillingProvider = {
  name: 'dev',

  async begin(input: BeginCheckoutInput): Promise<CheckoutIntent> {
    // Nothing is created provider-side: the local subscription row (made
    // by the service before begin) IS the pending payment.
    return {
      providerReference: `dev-${input.subscriptionId}`,
      checkoutUrl: devCheckoutUrl(input.subscriptionId, input.returnUrl),
      subscriptionId: input.subscriptionId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  },

  async verify(rawBody: string, headers: Record<string, string | null>): Promise<ProviderEvent> {
    const provided = headers[DEV_SIGNATURE_HEADER] ?? headers['x-billing-signature'];
    if (!provided) {
      throw new Error('dev billing: missing signature header');
    }

    const expected = devSignBody(rawBody);
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('dev billing: signature mismatch');
    }

    const body = JSON.parse(rawBody) as {
      event_id?: string;
      kind?: ProviderEventKind;
      organization_id?: string;
      subscription_id?: string;
      plan_code?: string;
      period_end?: string;
      failure_reason?: string;
    };

    if (!body.event_id || !body.kind || !body.organization_id) {
      throw new Error('dev billing: callback missing required fields');
    }

    return {
      id: body.event_id,
      kind: body.kind,
      providerReference: `dev-${body.subscription_id ?? 'unknown'}`,
      organizationId: body.organization_id,
      planCode: body.plan_code,
      periodEnd: body.period_end,
      failureReason: body.failure_reason,
    };
  },

  async cancel(): Promise<void> {
    // Nothing provider-side to cancel in dev.
  },
};
