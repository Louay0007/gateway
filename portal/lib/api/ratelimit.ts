/**
 * Generic request throttle — "N per window", per bucket.
 *
 * One table (`auth_login_attempts`, already keyed by a free-text bucket)
 * rather than a new schema, same as the D17 proof limit. A bucket allows
 * `max` hits per rolling window; the (max+1)-th is refused. The window is
 * anchored at the last hit and resets after `windowMs` of silence — a
 * ponytail: fixed-window-with-reset can burst at a boundary, upgrade to a
 * token bucket in the same table if that ever matters.
 *
 * Buckets come from the caller and are namespaced by feature, e.g.
 * `admin-gate:ip:1.2.3.4` or `chat:user:<id>`.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authLoginAttempts } from '@/db/schema';

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  max: number;
  /** Seconds until the window reopens; 0 when allowed. */
  retryAfterSeconds: number;
}

export async function rateLimit(
  bucket: string,
  opts: { max: number; windowMs: number; consume?: boolean },
): Promise<RateLimitResult> {
  const consume = opts.consume ?? true;
  const [row] = await db
    .select({
      failures: authLoginAttempts.failures,
      lastFailureAt: authLoginAttempts.lastFailureAt,
    })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.bucket, bucket));

  const elapsedMs = row?.lastFailureAt ? Date.now() - new Date(row.lastFailureAt).getTime() : Infinity;
  const withinWindow = elapsedMs < opts.windowMs;
  const used = withinWindow ? (row?.failures ?? 0) : 0;

  if (used >= opts.max) {
    return {
      allowed: false,
      used,
      max: opts.max,
      retryAfterSeconds: Math.max(1, Math.ceil((opts.windowMs - elapsedMs) / 1000)),
    };
  }

  if (!consume) {
    return { allowed: true, used, max: opts.max, retryAfterSeconds: 0 };
  }

  const count = withinWindow ? sql`${authLoginAttempts.failures} + 1` : sql`1`;
  await db
    .insert(authLoginAttempts)
    .values({ bucket, failures: 1, lastFailureAt: new Date() })
    .onConflictDoUpdate({
      target: authLoginAttempts.bucket,
      set: { failures: count, lastFailureAt: new Date(), lockedUntil: null },
    });

  return { allowed: true, used: used + 1, max: opts.max, retryAfterSeconds: 0 };
}

/** Forget a bucket — called on success so an honest user never accrues. */
export async function clearLimit(bucket: string): Promise<void> {
  await db.delete(authLoginAttempts).where(eq(authLoginAttempts.bucket, bucket));
}

/**
 * First hop of X-Forwarded-For, which Caddy sets. `unknown` is one shared
 * bucket on purpose: an unforwarded request is not a free pass.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export const MINUTE = 60_000;
