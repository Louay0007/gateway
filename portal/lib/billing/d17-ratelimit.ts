/**
 * D17 proof-submission rate limit — "N per hour", exactly.
 *
 * The login throttle (lib/auth/throttle.ts) encodes a different policy:
 * a couple of failures already trigger a backoff, because a mistyped
 * password is a signal. A payment proof is not: a customer who mistypes
 * an authorization number is not attacking us, and the brief asks for
 * five submissions per hour per IP and per subscription — not for a
 * 30-second penalty on the second attempt.
 *
 * Reuses the same table (no schema change) with explicit semantics:
 *
 *   - A bucket allows `max` submissions per rolling hour.
 *   - The (max+1)-th inside the window is refused BEFORE the counter
 *     moves, so a refused attempt cannot extend the lockout.
 *   - An hour of inactivity opens a fresh window and resets the count.
 *
 * Buckets come from the caller: `d17-proof:ip:<addr>` and
 * `d17-proof:sub:<subscriptionId>`.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authLoginAttempts } from '@/db/schema';
import { maxProofsPerHour } from './d17-config';

const HOUR_MS = 60 * 60 * 1000;

export interface SubmissionLimit {
  allowed: boolean;
  used: number;
  max: number;
}

/**
 * Count one submission for `bucket`. `allowed: false` means refuse.
 */
export async function recordSubmission(bucket: string): Promise<SubmissionLimit> {
  const max = maxProofsPerHour();

  const [previous] = await db
    .select({
      failures: authLoginAttempts.failures,
      lastFailureAt: authLoginAttempts.lastFailureAt,
    })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.bucket, bucket));

  const withinHour =
    previous?.lastFailureAt != null &&
    Date.now() - new Date(previous.lastFailureAt).getTime() < HOUR_MS;

  if (withinHour && (previous?.failures ?? 0) >= max) {
    // At the ceiling: refuse without counting, so a client hammering
    // the endpoint cannot keep its own lockout alive forever.
    return { allowed: false, used: previous.failures, max };
  }

  // Fresh window (or continuing one): reset the count when the previous
  // activity has aged out, so "per hour" stays a rolling window.
  const startAt = withinHour ? sql`${authLoginAttempts.failures} + 1` : sql`1`;

  await db
    .insert(authLoginAttempts)
    .values({ bucket, failures: 1, lastFailureAt: new Date() })
    .onConflictDoUpdate({
      target: authLoginAttempts.bucket,
      set: {
        failures: startAt,
        lastFailureAt: new Date(),
        lockedUntil: null,
      },
    });

  const [{ failures: now } = { failures: 1 }] = await db
    .select({ failures: authLoginAttempts.failures })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.bucket, bucket));

  return { allowed: true, used: now ?? 1, max };
}

/** Current state without counting — for the form's disabled state. */
export async function checkSubmission(bucket: string): Promise<SubmissionLimit> {
  const max = maxProofsPerHour();
  const [row] = await db
    .select({
      failures: authLoginAttempts.failures,
      lastFailureAt: authLoginAttempts.lastFailureAt,
    })
    .from(authLoginAttempts)
    .where(and(eq(authLoginAttempts.bucket, bucket)));

  const withinHour =
    row?.lastFailureAt != null && Date.now() - new Date(row.lastFailureAt).getTime() < HOUR_MS;
  const used = withinHour ? (row?.failures ?? 0) : 0;
  return { allowed: used < max, used, max };
}
