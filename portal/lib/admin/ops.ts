/**
 * Admin ops surface — jobs, alerts, and the health of the pipeline.
 *
 * `job_runs` and `system_alerts` were both written by the background
 * jobs and read by NOTHING except the jobs themselves. `send-alerts.ts`
 * reads `system_alerts` to dedupe its own email; `anomaly-alerts.ts`
 * reads its own `anomaly:` prefix. Neither writes a UI.
 *
 * The consequence was concrete: a `collect_usage` job that died three
 * weeks ago left no trace on any screen. The ledger just quietly stopped
 * growing, and the first sign was a customer saying their invoice looked
 * wrong. This file makes both tables visible, and makes a stuck job
 * something an operator SEES rather than something they infer from a
 * stale number.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Job health.
 *
 * `stale` is the field that matters. A job that has never run and a job
 * that ran on schedule both show a `last_run_at`; the difference is
 * whether it is recent. The threshold is deliberately loose (3× the job's
 * nominal interval, floored at 30 minutes) because the runner is invoked
 * by `make jobs` on a human schedule as well as by the timer, so a
 * "missed" interval is often just nobody having run it yet — this flags
 * for a look, it does not claim failure.
 */
export interface JobHealthRow {
  name: string;
  lastRunAt: string | null;
  lockedAt: string | null;
  attempts: number;
  lastError: string | null;
  /** Age of lastRunAt in seconds; null when it has never run. */
  ageSeconds: number | null;
  stale: boolean;
  locked: boolean;
}

/** Jobs the runner owns, with the interval they are expected to keep. */
const NOMINAL_INTERVAL_SECONDS: Record<string, number> = {
  collect_usage: 300,
  enforce_prompt_limits: 300,
  rollup_usage: 900,
  expire_subscriptions: 300,
  reconcile_entitlements: 3600,
  send_alerts: 900,
  detect_anomalies: 3600,
  // Hourly in scripts/jobs.ts — 300s here flagged it stale on every check.
  expire_trials: 3600,
};

export async function jobHealth(): Promise<JobHealthRow[]> {
  const rows = (await db.execute(sql`
    SELECT name, last_run_at, locked_at, attempts, last_error,
           EXTRACT(EPOCH FROM (now() - last_run_at))::float8 AS age_seconds
      FROM job_runs
     ORDER BY name ASC
  `)) as unknown as {
    name: string;
    last_run_at: Date | string | null;
    locked_at: Date | string | null;
    attempts: number;
    last_error: string | null;
    age_seconds: number | null;
  }[];

  return rows.map((r) => {
    const nominal = NOMINAL_INTERVAL_SECONDS[r.name] ?? 3600;
    const age = r.age_seconds == null ? null : Number(r.age_seconds);
    return {
      name: r.name,
      lastRunAt: iso(r.last_run_at),
      lockedAt: iso(r.locked_at),
      attempts: Number(r.attempts),
      lastError: r.last_error,
      ageSeconds: age,
      stale: age === null || age > Math.max(nominal * 3, 1800),
      // A lock older than 15 minutes is a crashed runner, not a running
      // one: the claim is `SELECT … FOR UPDATE SKIP LOCKED` with a
      // timeout, so a lock this old means the process died holding it.
      locked:
        r.locked_at != null &&
        (Date.now() - new Date(r.locked_at).getTime()) / 1000 < 900,
    };
  });
}

/**
 * Standing alerts, newest first.
 *
 * `system_alerts` is a state table, not a log: one row per condition,
 * holding the last state we mailed about. A cleared anomaly DELETES its
 * row (anomaly-alerts.ts does that), so absence is the correct signal
 * for "resolved" — which is why this returns rows only, and the UI
 * renders "nothing standing" rather than an empty timeline.
 */
export interface AlertRow {
  name: string;
  lastState: string;
  lastSentAt: string | null;
  /** `anomaly:…` rows are money-risk findings; others are ops-pipeline. */
  kind: 'anomaly' | 'ops';
  ageSeconds: number | null;
}

export async function standingAlerts(): Promise<AlertRow[]> {
  const rows = (await db.execute(sql`
    SELECT name, last_state, last_sent_at,
           EXTRACT(EPOCH FROM (now() - last_sent_at))::float8 AS age_seconds
      FROM system_alerts
     ORDER BY last_sent_at DESC NULLS LAST, name ASC
  `)) as unknown as {
    name: string;
    last_state: string;
    last_sent_at: Date | string | null;
    age_seconds: number | null;
  }[];

  return rows.map((r) => ({
    name: r.name,
    lastState: r.last_state,
    lastSentAt: iso(r.last_sent_at),
    kind: r.name.startsWith('anomaly:') ? 'anomaly' : 'ops',
    ageSeconds: r.age_seconds == null ? null : Number(r.age_seconds),
  }));
}

/**
 * Ledger freshness — the one number that says "the dashboard is lying".
 *
 * Usage is collected on a schedule, not streamed. If the newest row in
 * `usage_records` is old, every number derived from it is old, and the
 * dashboard renders those numbers without any indication of their age.
 * This is the check that turns "the chart looks wrong" into "the
 * collector is 4 hours behind".
 */
export async function ledgerFreshness(): Promise<{
  newestUsageAt: string | null;
  ageSeconds: number | null;
  /** Collector should have run within this many seconds. */
  expectedIntervalSeconds: number;
  fresh: boolean;
}> {
  const rows = (await db.execute(sql`
    SELECT max(occurred_at) AS newest
      FROM usage_records
  `)) as unknown as { newest: Date | string | null }[];

  const newest = rows[0]?.newest ?? null;
  const age = newest == null ? null : (Date.now() - new Date(newest).getTime()) / 1000;
  const expected = (NOMINAL_INTERVAL_SECONDS.collect_usage ?? 300) * 3;

  return {
    newestUsageAt: iso(newest),
    ageSeconds: age,
    expectedIntervalSeconds: expected,
    // An empty ledger is "fresh" by the age rule: there is nothing to be
    // behind. A brand-new install should not show a red banner because
    // it has no customers yet.
    fresh: age === null || age <= expected,
  };
}

function iso(v: Date | string | null): string | null {
  return v == null ? null : new Date(v).toISOString();
}