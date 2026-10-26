/**
 * Seasonal promotions — the single source of truth for discount windows.
 *
 * The Halloween sale is a PRICE discount on subscriptions, not a change to
 * the plan catalog: `plans.price_cents` stays the list price so entitlements,
 * overage maths, admin reporting and every historical invoice keep their
 * meaning. A promotion is projected onto the customer-facing summary and
 * applied once, at the moment a D17 payment row is created, which is the
 * only place money actually moves.
 *
 * Pure by design (no db, no env, no clock captured at import) so the window
 * and the arithmetic are unit-testable with an injected `now`.
 *
 * WINDOW: 25 Oct 2026 00:00 → 1 Nov 2026 00:00 Tunisia time (UTC+1). The
 * sale therefore covers all of 31 October and ends exactly at midnight
 * going into 1 November, as requested.
 */

export interface Promo {
  code: string;
  label: string;
  /** Whole percentage off the list price, e.g. 30 for −30%. */
  percentOff: number;
  /** ISO-8601 with offset. */
  startsAt: string;
  /** ISO-8601 with offset. Exclusive: the sale is over at this instant. */
  endsAt: string;
}

export const HALLOWEEN_PROMO: Promo = {
  code: 'halloween-2026',
  label: 'Halloween Special',
  percentOff: 30,
  startsAt: '2026-10-25T00:00:00+01:00',
  endsAt: '2026-11-01T00:00:00+01:00',
};

/** What a plan summary carries when the sale is live. */
export interface PromoView {
  code: string;
  label: string;
  percentOff: number;
  /** The catalog price before the discount, in integer cents. */
  originalPriceCents: number;
  /** The price the customer actually pays, in integer cents. */
  priceCents: number;
  endsAt: string;
}

/** True while `now` is inside the sale window. `endsAt` is exclusive. */
export function promoActive(now: Date = new Date(), promo: Promo = HALLOWEEN_PROMO): boolean {
  const t = now.getTime();
  return t >= Date.parse(promo.startsAt) && t < Date.parse(promo.endsAt);
}

/**
 * Apply the promotion to a list price.
 *
 * Zero and negative prices are returned untouched (the hidden trial plan is
 * free and must never acquire a negative price from rounding). The result is
 * rounded to the nearest cent so the displayed and charged amounts agree.
 */
export function promoPriceCents(
  listPriceCents: number,
  now: Date = new Date(),
  promo: Promo = HALLOWEEN_PROMO,
): number {
  if (listPriceCents <= 0 || !promoActive(now, promo)) return listPriceCents;
  return Math.round((listPriceCents * (100 - promo.percentOff)) / 100);
}

/**
 * Project a catalog price onto the customer-facing promo shape.
 *
 * Returns null outside the window (or for a free plan), so callers can use
 * `plan.promo?.priceCents ?? plan.priceCents` without a second date check.
 */
export function promoView(
  listPriceCents: number,
  now: Date = new Date(),
  promo: Promo = HALLOWEEN_PROMO,
): PromoView | null {
  if (listPriceCents <= 0 || !promoActive(now, promo)) return null;
  return {
    code: promo.code,
    label: promo.label,
    percentOff: promo.percentOff,
    originalPriceCents: listPriceCents,
    priceCents: promoPriceCents(listPriceCents, now, promo),
    endsAt: promo.endsAt,
  };
}
