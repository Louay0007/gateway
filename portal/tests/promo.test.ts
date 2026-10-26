/**
 * Seasonal promotion tests — the money arithmetic before money moves.
 *
 * The Halloween sale is applied in exactly two places: the customer-facing
 * plan summary (display) and `beginCheckout` (the payment row). Both derive
 * from `promoPriceCents`, so this file pins the arithmetic and the window
 * boundaries so a display price can never drift from a charged price.
 */

import { describe, expect, it } from 'vitest';
import {
  HALLOWEEN_PROMO,
  promoActive,
  promoPriceCents,
  promoView,
} from '@/lib/billing/promo';
import { summarizePlan } from '@/lib/billing/state';

const INSIDE = new Date('2026-10-26T12:00:00+01:00');
const BEFORE = new Date('2026-10-24T23:59:59+01:00');
const AT_END = new Date('2026-11-01T00:00:00+01:00');

describe('promoActive — the window', () => {
  it('opens at 25 Oct 00:00 Tunisia time (inclusive)', () => {
    expect(promoActive(new Date('2026-10-25T00:00:00+01:00'))).toBe(true);
    expect(promoActive(BEFORE)).toBe(false);
  });

  it('closes at 1 Nov 00:00 Tunisia time (exclusive)', () => {
    expect(promoActive(new Date('2026-10-31T23:59:59+01:00'))).toBe(true);
    expect(promoActive(AT_END)).toBe(false);
  });

  it('is 30% and dates are the Tunisian midnight boundary', () => {
    expect(HALLOWEEN_PROMO.percentOff).toBe(30);
    expect(HALLOWEEN_PROMO.endsAt).toBe('2026-11-01T00:00:00+01:00');
  });
});

describe('promoPriceCents — 30% off list', () => {
  // Catalog list prices are 1613 / 2903 cents — 50 DT / 90 DT at the 3.1
  // D17 rate (migration 0024). The sale takes 30% off those, so the charged
  // amounts are 35 DT / 63 DT, exactly what the pricing surfaces show.
  it('discounts Starter 1613 → 1129 (50 DT → 35 DT)', () => {
    expect(promoPriceCents(1613, INSIDE)).toBe(1129);
  });

  it('discounts Pro 2903 → 2032 (90 DT → 63 DT)', () => {
    expect(promoPriceCents(2903, INSIDE)).toBe(2032);
  });

  it('leaves free and negative prices untouched', () => {
    expect(promoPriceCents(0, INSIDE)).toBe(0);
    expect(promoPriceCents(-100, INSIDE)).toBe(-100);
  });

  it('returns the list price outside the window', () => {
    expect(promoPriceCents(1613, BEFORE)).toBe(1613);
    expect(promoPriceCents(2903, AT_END)).toBe(2903);
  });

  it('rounds to whole cents', () => {
    // 1999 × 0.70 = 1399.3 → 1399
    expect(promoPriceCents(1999, INSIDE)).toBe(1399);
  });
});

describe('promoView — what the UI renders', () => {
  it('carries both prices while live', () => {
    expect(promoView(2903, INSIDE)).toEqual({
      code: 'halloween-2026',
      label: 'Halloween Special',
      percentOff: 30,
      originalPriceCents: 2903,
      priceCents: 2032,
      endsAt: '2026-11-01T00:00:00+01:00',
    });
  });

  it('is null outside the window, so callers fall back to list price', () => {
    expect(promoView(2903, BEFORE)).toBeNull();
    expect(promoView(2903, AT_END)).toBeNull();
  });

  it('is null for the free trial plan', () => {
    expect(promoView(0, INSIDE)).toBeNull();
  });
});

describe('summarizePlan — promo projection', () => {
  const row = {
    code: 'starter',
    name: 'Starter',
    description: null,
    priceCents: 1613,
    interval: 'month',
    includedSpendCents: 2000,
    hardCapCents: 10000,
    rpmLimit: 60,
    tpmLimit: 200000,
    maxConcurrentRequests: 5,
    maxKeys: 3,
    rateMultiplierBps: 13000,
    models: ['fast'],
    tokenLimits: { fast: 80_000_000 },
  };

  it('keeps the list price and adds the discount', () => {
    const summary = summarizePlan(row, INSIDE);
    expect(summary.priceCents).toBe(1613);
    expect(summary.promo?.priceCents).toBe(1129);
    expect(summary.promo?.originalPriceCents).toBe(1613);
  });

  it('projects no promo outside the window', () => {
    const summary = summarizePlan(row, AT_END);
    expect(summary.priceCents).toBe(1613);
    expect(summary.promo).toBeNull();
  });
});
