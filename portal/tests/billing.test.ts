/**
 * Billing unit tests — the parts that must be right before money moves.
 *
 * Scope: the pure and near-pure surface of lib/billing. The full
 * lifecycle (paywall → checkout → activate → replay → upgrade → cancel →
 * revoke) is integration-tested against the live stack by
 * `make verify-metering`, which is the only place a fake database would
 * pretend to be good enough for money.
 *
 * The dev provider's signature verification is tested for real here
 * because it is the exact code path a real PSP's webhook verification
 * will take: raw bytes, constant-time compare, reject everything else.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_SIGNATURE_HEADER,
  devBillingProvider,
  devCheckoutUrl,
  devSignBody,
} from '@/lib/billing/dev';
import {
  BillingError,
  planStateFromStatus,
  summarizePlan,
} from '@/lib/billing/state';

const SECRET = 'unit-test-secret-placeholder-value';

beforeEach(() => {
  process.env.BILLING_DEV_SECRET = SECRET;
});

function signedBody(payload: Record<string, unknown>): { raw: string; sig: string } {
  const raw = JSON.stringify(payload);
  return { raw, sig: devSignBody(raw, SECRET) };
}

const goodPayload = {
  event_id: 'evt_1',
  kind: 'subscription.activated',
  organization_id: 'org-1',
  subscription_id: 'sub-1',
  plan_code: 'starter',
};

describe('dev provider callback verification', () => {
  it('accepts a correctly signed body and normalises the event', async () => {
    const { raw, sig } = signedBody(goodPayload);
    const event = await devBillingProvider.verify(raw, { [DEV_SIGNATURE_HEADER]: sig });

    expect(event.id).toBe('evt_1');
    expect(event.kind).toBe('subscription.activated');
    expect(event.organizationId).toBe('org-1');
    expect(event.planCode).toBe('starter');
    expect(event.providerReference).toBe('dev-sub-1');
  });

  it('rejects a tampered body (signature covers the raw bytes)', async () => {
    const { raw, sig } = signedBody(goodPayload);
    const tampered = raw.replace('starter', 'pro');

    await expect(
      devBillingProvider.verify(tampered, { [DEV_SIGNATURE_HEADER]: sig }),
    ).rejects.toThrow(/signature mismatch/i);
  });

  it('rejects a body signed with a different secret', async () => {
    const raw = JSON.stringify(goodPayload);
    const wrongSig = devSignBody(raw, 'a-different-secret-entirely');

    await expect(
      devBillingProvider.verify(raw, { [DEV_SIGNATURE_HEADER]: wrongSig }),
    ).rejects.toThrow(/signature mismatch/i);
  });

  it('rejects a missing signature header', async () => {
    const { raw } = signedBody(goodPayload);
    await expect(devBillingProvider.verify(raw, {})).rejects.toThrow(/missing signature/i);
  });

  it('rejects a signed body missing required fields', async () => {
    const { raw, sig } = signedBody({ event_id: 'evt_2', kind: 'subscription.canceled' });
    await expect(
      devBillingProvider.verify(raw, { [DEV_SIGNATURE_HEADER]: sig }),
    ).rejects.toThrow(/missing required fields/i);
  });

  it('refuses to sign without a configured secret', () => {
    const saved = process.env.BILLING_DEV_SECRET;
    delete process.env.BILLING_DEV_SECRET;
    try {
      expect(() => devSignBody('body')).toThrow(/BILLING_DEV_SECRET/);
    } finally {
      process.env.BILLING_DEV_SECRET = saved;
    }
  });
});

describe('dev provider checkout url', () => {
  it('is pre-signed for the subscription it activates', () => {
    const url = new URL(devCheckoutUrl('sub-42', '/dashboard/billing'));
    expect(url.pathname).toBe('/billing/confirm');
    expect(url.searchParams.get('subscription')).toBe('sub-42');
    expect(url.searchParams.get('return')).toBe('/dashboard/billing');
    // The signature proves the url was minted by us, not by the visitor.
    const sig = url.searchParams.get('sig');
    expect(sig).toBe(devSignBody('sub-42', SECRET));
    expect(sig).toHaveLength(64);
  });
});

describe('plan state vocabulary', () => {
  it('maps payment-incomplete to pending, everything else 1:1', () => {
    expect(planStateFromStatus('incomplete')).toBe('pending');
    expect(planStateFromStatus('active')).toBe('active');
    expect(planStateFromStatus('past_due')).toBe('past_due');
    expect(planStateFromStatus('canceled')).toBe('canceled');
    expect(planStateFromStatus('unpaid')).toBe('unpaid');
    expect(planStateFromStatus('paused')).toBe('paused');
  });

  it('treats a defensive trialing status as full access', () => {
    expect(planStateFromStatus('trialing')).toBe('active');
  });
});

describe('BillingError', () => {
  it('carries the http status the api layer answers with', () => {
    expect(new BillingError('validation', 'no').status).toBe(400);
    expect(new BillingError('conflict', 'no').status).toBe(409);
    expect(new BillingError('not_found', 'no').status).toBe(404);
    // A suspended account is refused the money path (0009 admin console).
    expect(new BillingError('forbidden', 'suspended').status).toBe(403);
    expect(new BillingError('upstream', 'no').status).toBe(502);
    expect(new BillingError('internal', 'no').status).toBe(500);
    // The paywall is a real status code, not a 500 pretending.
    expect(new BillingError('payment_required', 'choose a plan').status).toBe(402);
  });
});

describe('summarizePlan — trial terms (0009)', () => {
  const base = {
    code: 'starter',
    name: 'Starter',
    description: null,
    priceCents: 2000,
    interval: 'month',
    includedSpendCents: 2000,
    hardCapCents: 4000,
    rpmLimit: 60,
    tpmLimit: 100000,
    maxConcurrentRequests: 5,
    maxKeys: 2,
    rateMultiplierBps: 13000,
    models: ['gpt-4o-mini'],
  };

  });
