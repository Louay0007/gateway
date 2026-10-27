/**
 * Manual plan grants — the period arithmetic and the request shape.
 *
 * WHAT IS TESTED HERE AND WHY. A grant is the only admin action that
 * CREATES a service period out of nothing, so the two ways it can be
 * silently wrong are both pure and both invisible at runtime:
 *
 *   1. MONTH-END DRIFT. `new Date('2026-01-31')` plus a month is 3 March
 *      in JavaScript. A customer granted on the 31st would get a period
 *      that runs three days long and an end date no invoice agrees with.
 *      Every billing system means "the same day next month, or the last
 *      day of that month" — which is what `addMonthsClamped` does.
 *
 *   2. NON-IDEMPOTENCE. A grant SETS a window. If it extended instead,
 *      a double-click would hand out two months for one action and a
 *      wrong plan could only be corrected by granting another one.
 *
 *   Plus the shape guard: the body carries a plan CODE and nothing else.
 *   If a period were ever accepted from the client, a caller could grant
 *   ten years and the audit row would look ordinary.
 *
 * The database-backed half of a grant (one live row, in-place update, the
 * entitlement push) is asserted at the layer that can see rows —
 * `scripts/verify-metering.ts` drives it against a real Postgres.
 * Mocking `db` here would prove only that the mock was called.
 */
import { describe, it, expect } from 'vitest';

import {
  addMonthsClamped,
  grantPlanBodySchema,
  periodFor,
} from '@/lib/admin/grant-schema';

// ───────────────────────────────────────────────────────────────────────
//  Month-end clamping
// ───────────────────────────────────────────────────────────────────────

describe('addMonthsClamped', () => {
  it('keeps the day when the target month is long enough', () => {
    const from = new Date('2026-03-15T10:30:00.000Z');
    expect(addMonthsClamped(from, 1).toISOString()).toBe('2026-04-15T10:30:00.000Z');
  });

  it('clamps 31 Jan to the last day of February, not 3 March', () => {
    // The bug this exists to prevent: JS rolls 31 Jan + 1 month forward
    // into the next month, silently lengthening the granted period.
    const from = new Date('2026-01-31T00:00:00.000Z');
    const end = addMonthsClamped(from, 1);
    expect(end.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(end.getUTCMonth()).toBe(1);
  });

  it('clamps 31 January to 29 February in a leap year', () => {
    const from = new Date('2028-01-31T12:00:00.000Z');
    expect(addMonthsClamped(from, 1).toISOString()).toBe('2028-02-29T12:00:00.000Z');
  });

  it('clamps 31 March to 30 April', () => {
    const from = new Date('2026-03-31T09:00:00.000Z');
    expect(addMonthsClamped(from, 1).toISOString()).toBe('2026-04-30T09:00:00.000Z');
  });

  it('rolls the year over correctly from December', () => {
    const from = new Date('2026-12-15T00:00:00.000Z');
    expect(addMonthsClamped(from, 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('clamps a leap day one year forward to 28 February', () => {
    const from = new Date('2028-02-29T08:00:00.000Z');
    expect(addMonthsClamped(from, 12).toISOString()).toBe('2029-02-28T08:00:00.000Z');
  });

  it('preserves the time of day', () => {
    const from = new Date('2026-05-10T23:45:12.345Z');
    expect(addMonthsClamped(from, 1).toISOString()).toBe('2026-06-10T23:45:12.345Z');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  The granted window
// ───────────────────────────────────────────────────────────────────────

describe('periodFor', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('starts now and lasts one month on a monthly plan', () => {
    const { start, end } = periodFor('month', now);
    expect(start.toISOString()).toBe(now.toISOString());
    expect(end.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('lasts twelve months on a yearly plan', () => {
    const { start, end } = periodFor('year', now);
    expect(start.toISOString()).toBe(now.toISOString());
    expect(end.toISOString()).toBe('2027-06-15T12:00:00.000Z');
  });

  it('does not mutate the clock it was given', () => {
    const clock = new Date(now.getTime());
    periodFor('year', clock);
    expect(clock.toISOString()).toBe(now.toISOString());
  });

  it('is idempotent: the same clock grants the same window every time', () => {
    // Re-running a grant must not stack intervals. Two calls with the
    // same `now` are the only thing a double-click can produce.
    expect(periodFor('month', now).end.toISOString()).toBe(
      periodFor('month', now).end.toISOString(),
    );
  });

  it('always produces an end strictly after the start', () => {
    for (const interval of ['month', 'year'] as const) {
      const { start, end } = periodFor(interval, now);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Request shape
// ───────────────────────────────────────────────────────────────────────

describe('grantPlanBodySchema', () => {
  it('accepts a normal plan code', () => {
    expect(grantPlanBodySchema.safeParse({ planCode: 'pro' }).success).toBe(true);
    expect(grantPlanBodySchema.safeParse({ planCode: 'starter-tn' }).success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const parsed = grantPlanBodySchema.parse({ planCode: '  pro  ' });
    expect(parsed.planCode).toBe('pro');
  });

  it('rejects a missing or empty code', () => {
    expect(grantPlanBodySchema.safeParse({}).success).toBe(false);
    expect(grantPlanBodySchema.safeParse({ planCode: '' }).success).toBe(false);
    expect(grantPlanBodySchema.safeParse({ planCode: '   ' }).success).toBe(false);
  });

  it('rejects codes that are not slugs', () => {
    // Uppercase, spaces and punctuation are not plan codes, and accepting
    // them would mean the grant silently matches nothing.
    for (const bad of ['Pro', 'PRO', 'pro plan', 'pro/plan', '-pro', '_pro', 'pro!']) {
      expect(grantPlanBodySchema.safeParse({ planCode: bad }).success).toBe(false);
    }
  });

  it('rejects an over-long code', () => {
    expect(grantPlanBodySchema.safeParse({ planCode: 'a'.repeat(41) }).success).toBe(false);
  });

  it('IGNORES any period the client tries to send', () => {
    // Stripped, not forwarded: the service computes the window from the
    // plan's interval. If this ever started passing through, a caller
    // could grant ten years with a perfectly ordinary audit row.
    const parsed = grantPlanBodySchema.parse({
      planCode: 'pro',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual({ planCode: 'pro' });
  });
});
