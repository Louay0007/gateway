/**
 * When to tell a customer their pool is running out.
 *
 * WHY A PURE MODULE. This is the rule that decides whether a person gets an
 * email they did not ask for, at 15-minute job cadence. Getting it wrong in
 * either direction is a cost: too eager and the mail is muted (which is how
 * the next real warning is missed); too quiet and the first signal is a 403.
 * Being pure means every boundary is asserted in a test rather than
 * discovered from a customer complaint.
 *
 * THE THREE SEPARATE CONCEPTS, kept separate on purpose:
 *   - `threshold`  — a percentage of the period pool (80, 95).
 *   - `exhausted`  — the pool is actually gone; a distinct mail, because the
 *                    consequence (every model paused) is distinct.
 *   - `alreadySent`— the (org, period, threshold) ledger. Without it a job
 *                    running every 15 minutes mails the same threshold four
 *                    times an hour, and "80% used" arrives at 83%, 84%, 85%…
 */
import { quotaPercent } from '@/lib/dashboard/quota-tone';

export interface AlertDecisionInput {
  /** Pool size. Null/0 = unlimited, and an unlimited plan is never alerted. */
  poolTokens: number | null | undefined;
  poolUsedTokens: number;
  /** Thresholds the org subscribed to, ascending or not. */
  thresholds: number[];
  onExhausted: boolean;
  /** Thresholds already mailed this period. */
  alreadySent: number[];
}

export type AlertKind = 'threshold' | 'exhausted';

export interface AlertDecision {
  kind: AlertKind;
  /** 100 for the exhausted mail, otherwise the threshold %. */
  threshold: number;
}

/**
 * The single mail to send this pass, or null.
 *
 * AT MOST ONE PER PASS, highest threshold first. If an org jumps from 79%
 * to 97% between two passes — a heavy agent session does exactly that — the
 * honest mail is "you are out", not "you are at 80%" followed by "you are
 * at 95%" afterwards. Sending the highest crossed threshold first, and
 * letting the ledger absorb the rest, keeps the inbox proportional to the
 * situation.
 */
export function nextQuotaAlert({
  poolTokens,
  poolUsedTokens,
  thresholds,
  onExhausted,
  alreadySent,
}: AlertDecisionInput): AlertDecision | null {
  const limit =
    typeof poolTokens === 'number' && Number.isFinite(poolTokens) && poolTokens > 0
      ? poolTokens
      : null;
  // Unlimited plans have no threshold to cross and no exhaustion to reach.
  if (limit === null) return null;

  const used = Number.isFinite(poolUsedTokens) && poolUsedTokens > 0 ? poolUsedTokens : 0;
  const sent = new Set(alreadySent);

  if (used >= limit && onExhausted && !sent.has(100)) {
    return { kind: 'exhausted', threshold: 100 };
  }

  // Percentages already crossed, highest first. `quotaPercent` rounds the
  // same way the meter and the strip do, so a customer at "95% used" on the
  // page is the customer the 95 mail fires for.
  const pct = quotaPercent(used, limit);
  const crossed = [...new Set(thresholds)]
    .filter((t) => Number.isInteger(t) && t >= 1 && t <= 99)
    .filter((t) => pct >= t && !sent.has(t))
    .sort((a, b) => b - a);

  if (crossed.length === 0) return null;
  return { kind: 'threshold', threshold: crossed[0]! };
}

/** Defaults mirror `org_alert_prefs` (migration 0051). */
export const DEFAULT_THRESHOLDS = [80, 95] as const;

/**
 * Normalise whatever is stored into thresholds the rule accepts.
 *
 * A hand-edited row, or a value written before the CHECK existed, must not
 * be able to make the job throw: a broken preference is "no preference",
 * never a crashed alerting pass.
 */
export function normalizeThresholds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_THRESHOLDS];
  const clean = raw
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 100);
  return clean.length > 0 ? [...new Set(clean)].sort((a, b) => a - b) : [...DEFAULT_THRESHOLDS];
}
