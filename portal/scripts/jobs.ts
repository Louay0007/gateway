#!/usr/bin/env node
/**
 * Portal job runner — IMPLEMENTATION.md §4.
 *
 *   npm run jobs                     supervised loop (systemd / cron)
 *   npm run jobs:once                one pass of every job that is due
 *   npm run jobs:once -- collect_usage   one pass of a single job
 *
 * WHY A LOCK AT ALL. A collector that runs twice concurrently inserts the
 * same usage rows twice and rolls up a bill that is too high; two
 * entitlement reconciles push the same limits twice. The ledger
 * (`job_runs`) is the mutex: a job claims its row with an atomic
 * UPDATE…WHERE, so two runners cannot both hold it. A lock older than
 * STALE_LOCK_MINUTES is treated as abandoned — otherwise a `kill -9`
 * during a run silences that job until someone notices by hand, which is
 * the failure mode the Phase 5 acceptance criterion ("Kill -9
 * mid-collect → rerun inserts zero duplicates") is written against.
 *
 * The lock is a lease, not a mutex: it bounds the damage of a crashed
 * runner, it does not make work exactly-once. Exactly-once lives where it
 * belongs — in the ingestion itself, which is idempotent
 * (`usage_records.dedupe_hash`, ON CONFLICT DO NOTHING).
 *
 * `once` exits non-zero if any job failed, so a cron/systemd wrapper can
 * alert on it instead of discovering the failure in the numbers.
 */

import './env.mjs'; // MUST be first — see scripts/env.mjs.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { collectUsage, rollupUsage } from '@/lib/jobs/collect-usage';
import { reconcileEntitlements } from '@/lib/jobs/reconcile-entitlements';
import { expireSubscriptions } from '@/lib/jobs/expire-subscriptions';
import { sendOpsAlerts } from '@/lib/jobs/send-alerts';
import { detectAnomalies } from '@/lib/jobs/anomaly-alerts';
import { log } from '@/lib/log';

/** A lock older than this is assumed to belong to a dead process. */
const STALE_LOCK_MINUTES = 10;

/** How often the loop wakes to look for due work. */
const TICK_MS = 15_000;

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

/**
 * Schedule table — IMPLEMENTATION.md §4.
 *
 * Seven jobs run: the metering trio (collect, rollup, reconcile), the two
 * subscription clocks (expire_subscriptions for periods, expire_trials
 * for free trials), the ops alerting pass (send_alerts), and the
 * customer-shaped anomaly scan (detect_anomalies). A job is active only
 * when it is BOTH registered here AND present in `job_runs` (migrations
 * 0004/0009 seed the ledger rows) — adding one later is those two lines,
 * nothing else.
 */
const JOBS: readonly Job[] = [
  { name: 'collect_usage', everyMs: 5 * 60_000, run: () => collectUsage() },
  { name: 'rollup_usage', everyMs: 15 * 60_000, run: () => rollupUsage() },
  {
    name: 'reconcile_entitlements',
    everyMs: 60 * 60_000,
    run: () => reconcileEntitlements(),
  },
  {
    name: 'expire_subscriptions',
    everyMs: 5 * 60_000,
    run: () => expireSubscriptions(),
  },
  {
    name: 'send_alerts',
    everyMs: 15 * 60_000,
    run: () => sendOpsAlerts(),
  },
  {
    name: 'detect_anomalies',
    everyMs: 30 * 60_000,
    run: () => detectAnomalies(),
  },
];

/**
 * Claim the job's ledger row. Returns false when another runner holds a
 * fresh lock, or when this job is not registered in the ledger at all
 * (migration drift — run it by hand rather than silently doing nothing).
 */
async function acquireLock(name: string): Promise<boolean> {
  const claimed = (await db.execute(sql`
    UPDATE job_runs
       SET locked_at = now(),
           attempts   = job_runs.attempts + 1
     WHERE job_runs.name = ${name}
       AND (job_runs.locked_at IS NULL
            OR job_runs.locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute'))
    RETURNING job_runs.name
  `)) as unknown as { name: string }[];

  return claimed.length > 0;
}

async function release(name: string, error: string | null): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE job_runs
         SET locked_at   = NULL,
             -- Advanced on failure too: a job that never updates
             -- last_run_at is "due" on every tick and becomes a hot loop.
             last_run_at = now(),
             last_error  = ${error}
       WHERE job_runs.name = ${name}
    `);
  } catch (e) {
    // If we cannot write the ledger the lock stays until it goes stale.
    // Log loudly — it is self-healing, but only after STALE_LOCK_MINUTES.
    log.error('job lock release failed', {
      job: name,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function isDue(job: Job): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT last_run_at FROM job_runs WHERE job_runs.name = ${job.name}
  `)) as unknown as { last_run_at: Date | null }[];

  const row = rows[0];
  // Not in the ledger, or never run: due. A job absent from `job_runs`
  // will never acquire a lock either, and says so once per tick rather
  // than running silently.
  if (!row || !row.last_run_at) return true;
  return Date.now() - new Date(row.last_run_at).getTime() >= job.everyMs;
}

async function runJob(job: Job): Promise<boolean> {
  if (!(await isDue(job))) return true;
  if (!(await acquireLock(job.name))) {
    log.info('job skipped, locked elsewhere', { job: job.name });
    return true;
  }

  const startedAt = Date.now();
  try {
    const outcome = (await job.run()) ?? {};
    await release(job.name, null);
    log.info('job finished', {
      job: job.name,
      durationMs: Date.now() - startedAt,
      ...(typeof outcome === 'object' ? (outcome as Record<string, unknown>) : {}),
    });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await release(job.name, message.slice(0, 500));
    log.error('job failed', {
      job: job.name,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return false;
  }
}

/** One pass. Every job runs even if an earlier one failed — a broken
 *  collector must not stop the entitlement reconcile from firing. */
async function runOnce(only?: string): Promise<boolean> {
  const jobs = only ? JOBS.filter((j) => j.name === only) : [...JOBS];
  if (jobs.length === 0) {
    throw new Error(`unknown job "${only}" — known: ${JOBS.map((j) => j.name).join(', ')}`);
  }

  let ok = true;
  for (const job of jobs) {
    if (!(await runJob(job))) ok = false;
  }
  return ok;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    // Wake immediately on SIGTERM so a deploy does not wait out the tick.
    signal.addEventListener('abort', done, { once: true });
  });
}

async function loop(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  log.info('jobs runner started', { jobs: JOBS.map((j) => j.name) });

  while (!controller.signal.aborted) {
    try {
      await runOnce();
    } catch (e) {
      // A throw out of runOnce means the ledger itself is unreachable.
      // Back off a tick rather than exiting: the runner is supervised
      // and the alternative is an alert for a two-second Postgres blip.
      log.error('runner tick failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (controller.signal.aborted) break;
    await sleep(TICK_MS, controller.signal);
  }

  log.info('jobs runner stopped');
}

function usage(): void {
  process.stdout.write(
    'usage: jobs.ts [loop|once] [job_name]\n' +
      `jobs: ${JOBS.map((j) => `${j.name} (every ${j.everyMs / 60_000}m)`).join(', ')}\n`,
  );
}

async function main(): Promise<void> {
  const [mode, only] = process.argv.slice(2);

  if ([mode, only].some((a) => a === '--help' || a === '-h')) {
    usage();
    return;
  }

  if (mode === 'once') {
    const ok = await runOnce(only);
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (mode === 'loop' || mode === undefined) {
    await loop();
    return;
  }
  throw new Error(`unknown mode "${mode}" — expected loop or once`);
}

main().catch((e) => {
  log.error('jobs runner crashed', { error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});
