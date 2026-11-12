/**
 * GET /api/device/usage/history?days=7 — per-day per-alias token spend.
 *
 * The desktop panel showed one instant (`/api/device/usage`), so a customer
 * could see "12M of 50M used" and had no way to tell whether that was a
 * heavy morning or a week of steady burn. This is the trend line behind the
 * number, and the cheapest retention feature on the roadmap: it reads the
 * same `usage_records` the wall reads, grouped by Tunis calendar day.
 *
 * PER-DAY GROUPING IS INDEPENDENT OF THE QUOTA WINDOW. Since 0038 the wall
 * sums over the billing period, not the day — this endpoint still groups by
 * day because a spend TREND is genuinely daily, and "how much did I burn
 * yesterday" is the only question a trend answers. It reads the same rows
 * as the wall, so a bar and the quota panel can never disagree about which
 * day a token belongs to; they measure different spans on purpose.
 *
 * Bounded on purpose: `days` is clamped to 1..30 and a single grouped scan
 * over `usage_records_org_occurred_idx` serves it. No new table, no rollup
 * to keep in sync — a per-day rollup (G18) can replace this later without
 * changing the response shape.
 *
 * Response:
 *   { days: 7, timezone: 'Africa/Tunis', daily: [
 *       { day: '2026-11-01', tokensByModel: {fast: 123}, total: 123 },
 *       …   // exactly `days` entries, oldest first, empty days serialised here
 *   ] }
 *
 * Days with no rows are still returned, zero-filled server-side: a client
 * that has to decide what a missing day means will eventually draw a gap as
 * a zero or a zero as a gap, and only the server knows the window.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { MINUTE, rateLimit } from '@/lib/api/ratelimit';
import { bearerKey, keyDigest, orgIdForKey } from '@/lib/device/auth';
import { BILLABLE_TOKEN_COLUMNS, DAY_MS, TUNIS_OFFSET_MS } from '@/lib/entitlements/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DAYS = 30;
const DEFAULT_DAYS = 7;

/**
 * Same ceiling as `/api/device/usage`, and the same reasoning: the desktop
 * may re-render this on every panel open, and each call is a grouped scan.
 */
const HISTORY_MAX_PER_MINUTE = 60;

/** UTC midnight of the Tunis calendar day containing `now`, as a Date. */
function tunisDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + TUNIS_OFFSET_MS);
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(utcMidnight - TUNIS_OFFSET_MS);
}

/** `YYYY-MM-DD` of the Tunis day starting at `dayStart`. */
function tunisDayLabel(dayStart: Date): string {
  return new Date(dayStart.getTime() + TUNIS_OFFSET_MS).toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const key = bearerKey(request);
  if (!key) {
    return jsonError('unauthorized', 'Missing or malformed authorization header.');
  }

  try {
    const orgId = await orgIdForKey(key);
    if (!orgId) {
      return jsonError('unauthorized', 'Key not found or organization inactive.');
    }

    const limit = await rateLimit(`device-usage-history:${keyDigest(key).slice(0, 32)}`, {
      max: HISTORY_MAX_PER_MINUTE,
      windowMs: MINUTE,
    });
    if (!limit.allowed) {
      return jsonError('rate_limited', 'Too many history checks. Retry in a moment.', {
        'retry-after': String(limit.retryAfterSeconds),
      });
    }

    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
    const days =
      Number.isFinite(requested) && requested >= 1
        ? Math.min(MAX_DAYS, Math.floor(requested))
        : DEFAULT_DAYS;

    // Window: `days` complete Tunis days ending with today (today included
    // and partial on purpose — "yesterday" is the useful unit, and today's
    // bar is what the customer is watching grow).
    const todayStart = tunisDayStart(new Date());
    const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
    const to = new Date(todayStart.getTime() + DAY_MS);

    // One grouped scan, bucketed by Tunis calendar DATE.
    //
    // `(occurred_at + 1h) AT TIME ZONE 'UTC'` is a plain timestamp whose
    // date is the Tunis date of that instant — the offset is a constant (no
    // DST), so this is exact arithmetic, not a locale lookup. Deliberately
    // NOT `date_trunc('day', timestamptz)`: that truncates in the SESSION
    // timezone, so the same rows would bucket differently on a server whose
    // Postgres was not UTC.
    const rows = (await db.execute(sql`
      SELECT
        ((u.occurred_at + interval '1 hour') AT TIME ZONE 'UTC')::date AS day,
        u.model,
        coalesce(sum(${sql.raw(BILLABLE_TOKEN_COLUMNS)}), 0)::bigint AS tokens
        FROM usage_records u
       WHERE u.organization_id = ${orgId}::uuid
         AND u.occurred_at >= ${from.toISOString()}::timestamptz
         AND u.occurred_at <  ${to.toISOString()}::timestamptz
       GROUP BY day, u.model
       ORDER BY day ASC
    `)) as unknown as { day: string; model: string | null; tokens: string | number }[];

    const byDay = new Map<string, Record<string, number>>();
    for (const row of rows) {
      if (!row.model) continue;
      // `::date` comes back as `YYYY-MM-DD`; trust the label, not a Date
      // round-trip through the driver's timezone.
      const label = String(row.day).slice(0, 10);
      const bucket = byDay.get(label) ?? {};
      bucket[row.model] = (bucket[row.model] ?? 0) + Number(row.tokens ?? 0);
      byDay.set(label, bucket);
    }

    // Zero-fill, oldest first, exactly `days` entries.
    const daily: { day: string; tokensByModel: Record<string, number>; total: number }[] = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(from.getTime() + i * DAY_MS);
      const label = tunisDayLabel(dayStart);
      const tokensByModel = byDay.get(label) ?? {};
      const total = Object.values(tokensByModel).reduce((a, b) => a + b, 0);
      daily.push({ day: label, tokensByModel, total });
    }

    return Response.json({ days, timezone: 'Africa/Tunis', daily });
  } catch (e) {
    return errorResponse(e);
  }
}
