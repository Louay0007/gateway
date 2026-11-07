/**
 * Dodo provider unit tests — signature + event mapping.
 *
 * No DB: dodoSign/dodoVerifySignature/dodoEventKind are pure. The
 * verify() end-to-end path touches the DB (product lookup), so it is
 * not exercised here; the route + applyCallback integration is covered
 * by the billing tests.
 */

import { describe, expect, it } from 'vitest';
import {
  dodoEventKind,
  dodoSign,
  dodoVerifySignature,
} from '@/lib/billing/dodo';

const KEY = Buffer.from('test-signing-key');

function signed(id: string, ts: string, body: string) {
  return dodoSign(id, ts, body, KEY);
}

describe('dodoVerifySignature', () => {
  const id = 'wh_123';
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: 'subscription.active' });
  const sig = signed(id, ts, body);

  it('verifies a correctly signed payload', () => {
    expect(dodoVerifySignature(id, ts, body, sig, KEY)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(dodoVerifySignature(id, ts, body + ' ', sig, KEY)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const other = Buffer.from('other-key');
    expect(dodoVerifySignature(id, ts, body, signed(id, ts, body) , other)).toBe(false);
  });

  it('accepts when ANY entry in a multi-entry list matches', () => {
    const list = `v1,bogus ${sig} v1,also-bogus`;
    expect(dodoVerifySignature(id, ts, body, list, KEY)).toBe(true);
  });

  it('rejects when no entry matches', () => {
    expect(dodoVerifySignature(id, ts, body, 'v1,bogus v1,nope', KEY)).toBe(false);
  });
});

describe('dodoEventKind', () => {
  it('maps activation events', () => {
    expect(dodoEventKind('subscription.active')).toBe('subscription.activated');
    expect(dodoEventKind('subscription.renewed')).toBe('subscription.activated');
  });

  it('maps grace-window events to payment_failed', () => {
    expect(dodoEventKind('subscription.past_due')).toBe('subscription.payment_failed');
    expect(dodoEventKind('subscription.on_hold')).toBe('subscription.payment_failed');
  });

  it('maps terminal events to canceled', () => {
    expect(dodoEventKind('subscription.cancelled')).toBe('subscription.canceled');
    expect(dodoEventKind('subscription.expired')).toBe('subscription.canceled');
    expect(dodoEventKind('subscription.failed')).toBe('subscription.canceled');
  });

  it('returns null (verified, not acted on) for everything else', () => {
    expect(dodoEventKind('subscription.updated')).toBeNull();
    expect(dodoEventKind('subscription.plan_changed')).toBeNull();
    expect(dodoEventKind('payment.succeeded')).toBeNull();
    expect(dodoEventKind('')).toBeNull();
  });
});
