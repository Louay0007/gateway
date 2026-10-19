/**
 * Admin gate throttling — brute-force control for the shared access code.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM `lib/auth/throttle.ts`.
 *
 * The operations console used to be reachable only from an IP allowlist at
 * the edge, so the gate code could not be attacked at volume. That allowlist
 * has been removed: the console is now public and the secret code is the
 * ONLY pre-authentication layer in front of the staff console. Without a
 * throttle here, `/api/admin/gate` is a brute-forceable endpoint on the open
 * internet, and a short or reused code falls to a script.
 *
 * `auth_login_attempts` is reused rather than adding a table: its `bucket`
 * key is already generic, its columns are exactly the ones needed, and a new
 * table would be a migration for no structural gain. The prefix `gate:`
 * keeps these rows from ever colliding with login rows.
 *
 * Backoff is keyed on the caller's IP. A global bucket is deliberately NOT
 * used: with a single shared secret there is no per-identity key, so a global
 * bucket would let any anonymous visitor lock the operator out permanently —
 * a denial of service against the only way into the console. Per-IP means an
 * attacker can lock THEMSELVES out and nobody else.
 *
 * The IP is read from `x-forwarded-for`, which Caddy sets from the TCP peer.
 * That is trustworthy here only because DESIGN.md §6.1 locks "no CDN": with
 * no intermediary, the connection peer IS the client, and Caddy's default is
 * to strip inbound X-Forwarded-* and set it from the connection. Adding a CDN
 * would make this key attacker-controlled and the throttle bypassable by
 * varying a header — the same reason `lib/auth/throttle.ts` does not key on
 * IP. Re-derive this if the CDN decision is ever reversed.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authLoginAttempts } from '@/db/schema';

/** Wrong codes tolerated before the caller starts backing off. */
const FREE_ATTEMPTS = 4;

/**
 * Backoff in seconds, indexed by TOTAL consecutive failures.
 *
 * The leading zeros are load-bearing and must match FREE_ATTEMPTS: the
 * index is the failure count itself, not the count past the allowance.
 * Four free attempts means failures 1–4 map to 0, and the lock starts on
 * the FIFTH wrong code. `lib/auth/throttle.ts` does the same thing with a
 * 5-attempt allowance, which is why its table also opens with two zeros —
 * an earlier version of this file opened with a single zero and locked the
 * operator out for 30s after a SINGLE typo, which is indistinguishable
 * from the gate being broken.
 */
const BACKOFF_SECONDS = [0, 0, 0, 0, 30, 60, 300, 900, 3600];

export interface GateThrottleState {
  blocked: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Best-effort client IP from the proxy.
 *
 * Returns `unknown` when the header is absent or unparseable, which
 * collapses those callers into one shared bucket. That is a real (if
 * unlikely) lockout risk rather than a bypass: Caddy always sets the
 * header, so `unknown` means something upstream is misconfigured.
 */
export function clientIp(headers: Headers): string {
  const raw = headers.get('x-forwarded-for');
  if (!raw) return 'unknown';
  // Left-most entry is the original client; Caddy appends the peers it saw.
  const first = raw.split(',')[0]?.trim() ?? '';
  if (!first) return 'unknown';
  // Accept only something shaped like an address, so a garbage header
  // cannot be used to create unbounded distinct buckets.
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(first);
  const isIPv6 = /^[0-9a-fA-F:]+$/.test(first) && first.includes(':');
  return isIPv4 || isIPv6 ? first : 'unknown';
}

function bucketFor(ip: string): string {
  return `gate:ip:${ip || 'unknown'}`;
}

/** Read the current state WITHOUT recording an attempt. */
export async function checkGateThrottle(ip: string): Promise<GateThrottleState> {
  const row = await db.query.authLoginAttempts.findFirst({
    where: eq(authLoginAttempts.bucket, bucketFor(ip)),
  });

  const now = Date.now();
  if (row?.lockedUntil) {
    const ms = new Date(row.lockedUntil).getTime() - now;
    if (ms > 0) {
      return {
        blocked: true,
        retryAfterSeconds: Math.ceil(ms / 1000),
        remaining: 0,
      };
    }
  }

  const failures = row?.failures ?? 0;
  return {
    blocked: false,
    retryAfterSeconds: 0,
    remaining: Math.max(0, FREE_ATTEMPTS - failures),
  };
}

/**
 * Record a wrong code and return the state that applies NOW, so the caller
 * can answer 429 on the very attempt that trips the limit rather than one
 * attempt later.
 */
export async function recordGateFailure(ip: string): Promise<GateThrottleState> {
  const bucket = bucketFor(ip);

  await db
    .insert(authLoginAttempts)
    .values({ bucket, failures: 1, lastFailureAt: new Date() })
    .onConflictDoUpdate({
      target: authLoginAttempts.bucket,
      set: {
        failures: sql`${authLoginAttempts.failures} + 1`,
        lastFailureAt: new Date(),
        // Clear an expired lock so a returning operator starts clean.
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

  const row = await db.query.authLoginAttempts.findFirst({
    where: eq(authLoginAttempts.bucket, bucket),
  });
  const failures = row?.failures ?? 0;

  const delay = BACKOFF_SECONDS[Math.min(failures, BACKOFF_SECONDS.length - 1)] ?? 0;
  if (delay > 0) {
    await db
      .update(authLoginAttempts)
      .set({ lockedUntil: new Date(Date.now() + delay * 1000) })
      .where(eq(authLoginAttempts.bucket, bucket));
  }

  return {
    blocked: delay > 0,
    retryAfterSeconds: delay,
    remaining: Math.max(0, FREE_ATTEMPTS - failures),
  };
}

/**
 * Clear the counter after a correct code, so an operator who fumbled twice
 * and then got it right does not carry the streak into their next attempt.
 */
export async function recordGateSuccess(ip: string): Promise<void> {
  await db
    .delete(authLoginAttempts)
    .where(eq(authLoginAttempts.bucket, bucketFor(ip)));
}

/** Housekeeping — keep gate rows from outliving their usefulness. */
export async function pruneGateAttempts(): Promise<number> {
  const rows = await db
    .delete(authLoginAttempts)
    .where(
      and(
        sql`${authLoginAttempts.bucket} LIKE 'gate:ip:%'`,
        lt(authLoginAttempts.lastFailureAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .returning({ bucket: authLoginAttempts.bucket });
  return rows.length;
}