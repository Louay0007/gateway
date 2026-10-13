'use server';

/**
 * The dev payment simulator's server action — the missing half of
 * `devCheckoutUrl()`.
 *
 * `dev.ts` documents the flow this completes:
 *
 *   1. `begin()` returns `/billing/confirm?subscription=…&return=…&sig=…`
 *   2. that page POSTs to `/api/billing/callback` with a JSON body signed
 *      the same way a PSP signs its webhook
 *   3. `verify()` recomputes the HMAC and rejects anything else
 *
 * Step 1 pointed at a page that did not exist, so with `BILLING_PROVIDER=dev`
 * — the local default — checkout was a dead end: the URL 404'd and the
 * simulated payment could never be completed from a browser. Only
 * `scripts/verify-metering.ts`, which signs the callback itself, could
 * reach an activation.
 *
 * WHY THIS POSTS OVER HTTP RATHER THAN CALLING applyCallback() DIRECTLY.
 * The point of the simulator is to exercise the real webhook route:
 * signature verification over the raw body, the `billing_events` dedupe,
 * the entitlement sync, and the audit row. Calling the service in-process
 * would prove the service and skip the route, which is where the other
 * half of Tier 1 lived. The fetch goes to the portal's OWN origin, so the
 * callback lands in the same process that served the page.
 */

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { plans, subscriptions } from '@/db/schema';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { billingProvider } from '@/lib/billing/index';
import { DEV_SIGNATURE_HEADER, devSignBody } from '@/lib/billing/dev';
import { log } from '@/lib/log';

export interface DevPayState {
  error?: string;
}

/**
 * Where this container can reach itself.
 *
 * The portal service publishes on 127.0.0.1:3000 and has no
 * PORTAL_INTERNAL_URL of its own (the jobs container gets one, because
 * for it 127.0.0.1 IS itself). APP_URL is the public origin, which is not
 * necessarily routable from inside the container — hence the loopback
 * default, with the internal URL honoured when a deployment sets it.
 */
function selfOrigin(): string {
  return (process.env.PORTAL_INTERNAL_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

/**
 * Only same-site relative paths are accepted. `return` arrives from the
 * URL, and an open redirect on the page a customer lands on after paying
 * is a phishing primitive — the attacker picks the destination and the
 * victim arrives straight from a genuine payment.
 */
function safeReturnPath(raw: string | null): string {
  if (!raw) return '/dashboard/billing';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard/billing';
  return raw;
}

/**
 * Complete the simulated payment.
 *
 * `nonce` is rendered into the page once and posted back unchanged. It is
 * the activation-attempt identity that becomes the `billing_events` id
 * (`dev:<subscriptionId>:<nonce>`), which gives two things for free:
 *
 *   - a double-click posts the same nonce, so the second activation is
 *     deduped to a no-op instead of a second event;
 *   - a re-subscription after a cancel renders a fresh page with a fresh
 *     nonce, so it is NOT deduped against the previous activation.
 *
 * A constant event id would satisfy the first and permanently break the
 * second — the account could pay once and never again.
 */
export async function payDevSubscription(
  _prev: DevPayState,
  formData: FormData,
): Promise<DevPayState> {
  const subscriptionId = String(formData.get('subscriptionId') ?? '');
  const nonce = String(formData.get('nonce') ?? '');
  const returnTo = safeReturnPath(String(formData.get('returnTo') ?? ''));

  if (!subscriptionId || !nonce) {
    return { error: 'This payment link is incomplete. Start again from your billing page.' };
  }

  // The dev provider must be the live one. If a deployment selected d17,
  // this page must not be able to activate anything.
  if (billingProvider.name !== 'dev') {
    return { error: 'The test payment simulator is not enabled on this deployment.' };
  }

  const ctx = await requireActiveOrg();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  // Not `notFound()`: a subscription belonging to another org must be
  // indistinguishable from one that does not exist.
  if (!sub || sub.organizationId !== ctx.orgId) {
    return { error: 'That subscription could not be found.' };
  }
  if (sub.status === 'active') {
    redirect('/dashboard/billing?state=active');
  }

  const plan = await db.query.plans.findFirst({ where: eq(plans.id, sub.planId) });
  if (!plan) {
    return { error: 'The plan for this subscription is missing.' };
  }

  const rawBody = JSON.stringify({
    event_id: `dev:${sub.id}:${nonce}`,
    kind: 'subscription.activated',
    organization_id: sub.organizationId,
    subscription_id: sub.id,
    plan_code: plan.code,
  });

  let ok = false;
  let detail = '';
  try {
    const res = await fetch(`${selfOrigin()}/api/billing/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [DEV_SIGNATURE_HEADER]: devSignBody(rawBody),
      },
      body: rawBody,
      // A callback that waits on the gateway can take seconds.
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    ok = res.ok;
    if (!ok) detail = await res.text().catch(() => '');
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }

  if (!ok) {
    // Log the detail, never show it: the body carries the provider's own
    // error text and a stack-shaped message from the callback route.
    log.error('dev checkout: callback rejected', {
      subscriptionId: sub.id,
      organizationId: sub.organizationId,
      status: detail.slice(0, 200),
    });
    return {
      error: 'The simulated payment could not be applied. It has not been charged — try again.',
    };
  }

  log.info('dev checkout: subscription activated', {
    subscriptionId: sub.id,
    organizationId: sub.organizationId,
  });

  redirect(returnTo);
}