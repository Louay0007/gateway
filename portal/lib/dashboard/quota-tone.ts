/**
 * The one place the quota "tone" is decided.
 *
 * WHY A MODULE AND NOT A CONSTANT IN THE COMPONENT. The status strip at the
 * top of the Overview and the bar inside the budget card must agree about
 * whether an account is "fine", "almost out" or "out" — two thresholds
 * written twice is how a page ends up saying "96% used" in one place and
 * painting the bar amber in another. The numbers live here, the components
 * import them.
 *
 * Pure: no React, no database, no formatting. That is what lets the
 * boundaries be asserted in a test instead of eyeballed in a screenshot.
 */

export type QuotaTone =
  | 'healthy'
  | 'watching'
  | 'warning'
  | 'blocked'
  | 'unlimited';

/** Percentage of the pool spent, clamped to 0..100. */
export function quotaPercent(used: number, limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 0;
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  return Math.min(100, Math.round((u / limit) * 100));
}

/**
 * Tone for a pool.
 *
 * `null` / `0` / negative limit means the plan has no token budget at all —
 * `unlimited`, never `blocked`. That mirrors `computeTokenAllowedModels`,
 * where a missing budget fails open rather than cutting the customer off.
 */
export function quotaTone(used: number, limit: number | null | undefined): QuotaTone {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return 'unlimited';
  }
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  if (u >= limit) return 'blocked';
  if (u / limit >= 0.95) return 'warning';
  if (u / limit >= 0.8) return 'watching';
  return 'healthy';
}

/** True for the two tones that mean "something needs you". */
export function needsAttention(tone: QuotaTone): boolean {
  return tone === 'warning' || tone === 'blocked';
}

const DAY_MS = 86_400_000;

/**
 * Whole days left at the current average burn, or null when unknowable.
 *
 * Deliberately conservative arithmetic: no trend line, no projection curve,
 * just "spent so far divided by days elapsed". A customer who burned 4M in
 * one day of a 30-day period is told the truth about that day, and the
 * number moves as the period ages — which is the only honest reading of
 * "at this rate".
 *
 * Returns null when the rate is zero (nothing has been spent, so there is
 * no "rate"), when the period start is missing or in the future, or when
 * the inputs are not finite.
 */
export function daysRemainingAtRate(
  limit: number | null | undefined,
  used: number,
  periodStart: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;
  if (!periodStart) return null;
  const start = new Date(periodStart).getTime();
  if (!Number.isFinite(start)) return null;

  const elapsedDays = (now.getTime() - start) / DAY_MS;
  // A period that has not started yet has no rate to average over.
  if (!(elapsedDays > 0)) return null;

  const u = Number.isFinite(used) && used > 0 ? used : 0;
  if (u <= 0) return null;

  const perDay = u / elapsedDays;
  if (!(perDay > 0)) return null;

  const left = limit - u;
  if (left <= 0) return 0;
  return Math.floor(left / perDay);
}
