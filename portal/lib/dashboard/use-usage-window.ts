"use client";

import * as React from 'react';

/**
 * The one implementation of "last N days" as `from`/`to` datetimes.
 *
 * WHY IT EXISTS. `usage-view.tsx` computed this window three times — once
 * for the table query, once for the chart series and once for the CSV
 * export — because each needed a slightly different query string. Three
 * copies of the same arithmetic drift: a fix to the boundary in one left
 * the export describing a different range than the screen, which is the
 * worst kind of export bug because the customer finds it while
 * reconciling.
 *
 * The endpoint takes absolute datetimes (`GET /api/usage`), not a day
 * count, so the window is resolved on the client at render time. That is
 * the honest reading of a rolling window: a shared link to "last 7 days"
 * means seven days from when it is opened.
 */

export interface UsageWindow {
  /** Whole days in the window. */
  days: number;
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
}

const DAY_MS = 86_400_000;

/**
 * Build the window for `range` (a day count from the URL).
 *
 * `now` is injectable so a test can pin the clock; production calls it with
 * the default. `days` is clamped to a positive integer, and an unparseable
 * range falls back to 30 — the same default the view uses.
 */
export function usageWindowFor(range: number | string | null | undefined, now: Date = new Date()): UsageWindow {
  const parsed = typeof range === 'number' ? range : Number(range ?? 30);
  const days = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);
  return {
    days,
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

/**
 * The memoised form used by the views.
 *
 * Keyed on the range string so a re-render with the same window does not
 * rebuild the query and re-fire the fetch (`useApi` depends on the path
 * string, so an unstable window would loop).
 */
export function useUsageWindow(range: string | null | undefined): UsageWindow {
  return React.useMemo(() => usageWindowFor(range), [range]);
}
