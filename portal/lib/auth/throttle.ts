/**
 * Login rate limiting — brute-force and credential-stuffing control.
 *
 * A self-hosted Credentials provider has no upstream WAF to lean on, so
 * this is a first-class security control, not a nice-to-have. PLATFORM.md
 * §9.1 treats card fraud as the threat; this is the authentication-side
 * equivalent — the layer that stops password spraying against the customer
 * database.
 *
 * Design notes:
 *  - Backed by Postgres (already required), so it works across replicas
 *    and survives a restart. An in-memory limiter is defeated by exactly
 *    the multi-process deployment this system uses.
 *  - Progressive backoff: throttling triggers on sustained failures rather
 *    than a flat count, so a user who mistypes twice is not locked out,
 *    but a sprayer is stopped after a handful.
 *  - Keyed on identity (email). IP keying is deliberately NOT applied yet:
 *    there is no CDN (DESIGN.md §6.1), so no forwarded header can be
 *    trusted, and a spoofable IP key would be a control an attacker can
 *    bypass by varying the header. The schema is already generic
 *    (`bucket`), so `ip:<addr>` can be added at the edge later.
 *
 * Written with the Drizzle query builder rather than `= ANY(${array})`:
 * interpolating a JS array into `sql` produces a single parameter, not a
 * Postgres array, and the database rejects it with
 * "op ANY/ALL (array) requires array on right side".
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authLoginAttempts } from '@/db/schema';

/** Failures tolerated before the identity key starts backing off. */
const FREE_ATTEMPTS = 5;

/** Backoff in seconds, indexed by consecutive failures past the allowance. */
const BACKOFF_SECONDS = [0, 0, 30, 60, 300, 900, 3600];

export interface AttemptState {
  blocked: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Read the current throttle state without recording an attempt.
 * Used to grey out the form and show a countdown.
 */
export async function checkThrottle(identity: string, ip: string): Promise<AttemptState> {
  const buckets = bucketsFor(identity, ip);
  const rows = await db
    .select()
    .from(authLoginAttempts)
    .where(inArray(authLoginAttempts.bucket, buckets));

  const now = Date.now();
  let retryAfterSeconds = 0;
  let remaining = FREE_ATTEMPTS;

  for (const row of rows) {
    if (row.lockedUntil) {
      const ms = new Date(row.lockedUntil).getTime() - now;
      if (ms > 0) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(ms / 1000));
        continue;
      }
      // Lock already expired — it does not count against the caller now.
    }
    remaining = Math.min(remaining, FREE_ATTEMPTS - row.failures);
  }

  return {
    blocked: retryAfterSeconds > 0,
    retryAfterSeconds,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Record a failed login. Returns the throttle state that now applies, so
 * the caller can return 429 with the correct delay on the very attempt
 * that trips the limit — rather than one attempt later.
 */
export async function recordFailure(identity: string, ip: string): Promise<AttemptState> {
  const buckets = bucketsFor(identity, ip);

  // One upsert per bucket. `excluded` is the row we tried to insert;
  // incrementing off it avoids a read-modify-write race between two
  // concurrent attempts from the same identity.
  for (const bucket of buckets) {
    await db
      .insert(authLoginAttempts)
      .values({ bucket, failures: 1, lastFailureAt: new Date() })
      .onConflictDoUpdate({
        target: authLoginAttempts.bucket,
        set: {
          failures: sql`${authLoginAttempts.failures} + 1`,
          lastFailureAt: new Date(),
          // Clear an expired lock so a returning user starts clean.
          lockedUntil: sql`
            CASE
              WHEN ${authLoginAttempts.lockedUntil} IS NOT NULL
               AND ${authLoginAttempts.lockedUntil} < now()
              THEN NULL
              ELSE ${authLoginAttempts.lockedUntil}
            END
          `,
        },
      });
  }

  const rows = await db
    .select()
    .from(authLoginAttempts)
    .where(inArray(authLoginAttempts.bucket, buckets));

  const failures = rows.reduce((max, r) => Math.max(max, r.failures), 0);
  const delay = BACKOFF_SECONDS[Math.min(failures, BACKOFF_SECONDS.length - 1)] ?? 0;

  if (delay > 0) {
    await db
      .update(authLoginAttempts)
      .set({ lockedUntil: new Date(Date.now() + delay * 1000) })
      .where(inArray(authLoginAttempts.bucket, buckets));
  }

  return {
    blocked: delay > 0,
    retryAfterSeconds: delay,
    remaining: Math.max(0, FREE_ATTEMPTS - failures),
  };
}

/**
 * Clear the counters after a successful authentication. Without this a
 * legitimate user who fumbled a few times then succeeded carries the prior
 * streak into their next session.
 */
export async function recordSuccess(identity: string, ip: string): Promise<void> {
  await db
    .delete(authLoginAttempts)
    .where(inArray(authLoginAttempts.bucket, bucketsFor(identity, ip)));
}

/** Housekeeping: drop rows untouched for 24h so the table stays small. */
export async function pruneAttempts(): Promise<number> {
  const deleted = await db
    .delete(authLoginAttempts)
    .where(lt(authLoginAttempts.lastFailureAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .returning({ bucket: authLoginAttempts.bucket });
  return deleted.length;
}

function bucketsFor(identity: string, ip: string): string[] {
  const set = new Set<string>();
  if (identity) set.add(`id:${identity}`);
  if (ip && ip !== 'unknown') set.add(`ip:${ip}`);
  return set.size ? [...set] : ['id:unknown'];
}