/**
 * Manual plan grant — request shape and period arithmetic.
 *
 * Split from `lib/admin/subscriptions.ts` for the same reason
 * `plan-schema.ts` is split from `plans.ts`: a `route.ts` may only export
 * HTTP handlers and route config, so the zod schema cannot live there, and
 * the period math is pure and worth testing without a database.
 *
 * WHY THE PERIOD IS COMPUTED, NOT COPIED. Every other write path in the
 * billing module derives its period from a provider payload. A manual
 * grant has no payload, so the window has to be constructed — and month
 * ends are where naive construction breaks: `new Date('2026-01-31')` plus
 * one month is 3 March, which would hand a customer a period three days
 * longer than they were granted and print an end date no invoice agrees
 * with. `periodFor` clamps to the last valid day of the target month
 * instead (31 Jan + 1 month = 28 Feb, or 29 Feb in a leap year), which is
 * what every billing system means by "one month from today".
 */

import { z } from 'zod';

/** Plan codes are the public slug used in URLs and audit rows. */
const PLAN_CODE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const grantPlanBodySchema = z.object({
  planCode: z
    .string()
    .trim()
    .min(1, 'Choose a plan.')
    .max(40)
    .regex(PLAN_CODE, 'That is not a valid plan code.'),
});

export type GrantPlanBody = z.infer<typeof grantPlanBodySchema>;

export type PlanInterval = 'month' | 'year';

export interface Period {
  start: Date;
  end: Date;
}

/**
 * Add whole months in UTC, clamping the day to the target month's length.
 *
 * `Date.UTC(year, month, 0)` is the last day of `month`, which is the
 * cheapest correct clamp in the language. Years reuse it with 12 months
 * so a leap day lands on 28 February the next year rather than rolling
 * into March.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth() + months;
  // The first day of the target month tells us both the real year (the
  // index may overflow past 11) and how long that month is.
  const firstOfTarget = new Date(Date.UTC(year, monthIndex, 1));
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth(),
      Math.min(from.getUTCDate(), daysInTarget),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * The window a fresh grant covers: starts now, ends after exactly one
 * plan interval.
 *
 * "Fresh" is deliberate and is the whole reason this function exists
 * rather than reusing `changePlan`'s extension logic: re-running a grant
 * must be idempotent. If a second click added another month on top of the
 * end it just wrote, a double-click would hand out two months of service
 * for one action, and a mistyped plan could only be corrected by waiting
 * a month or granting yet another one.
 */
export function periodFor(interval: PlanInterval, now: Date = new Date()): Period {
  const start = new Date(now.getTime());
  const end = interval === 'year' ? addMonthsClamped(start, 12) : addMonthsClamped(start, 1);
  return { start, end };
}
