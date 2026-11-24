"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { UsageSeriesPoint } from "@/lib/api/types";

/**
 * RequestSpark — the shape behind a request count.
 *
 * "412 requests" is a number with no trend in it; a quiet account and one
 * spiking at 60× its average look identical. This draws the last 24 hours
 * as bars beside the count, from `GET /api/usage/summary?bucket=hour` —
 * an endpoint that already existed and the UI simply never asked.
 *
 * NO LIBRARY, DELIBERATELY. A 24-point sparkline does not need a chart
 * engine: 24 divs with a proportional height render instantly, hold no
 * layout thrash and cost nothing on the server. Recharts stays for the one
 * real chart.
 *
 * It is decoration with an accessible label rather than a data table: the
 * exact numbers are on the chart below, and a screen-reader user should not
 * hear 24 values read out.
 */
export function RequestSpark({
  points,
  className,
}: {
  points: UsageSeriesPoint[];
  className?: string;
}) {
  const { bars, peak } = useMemo(() => {
    const values = points.map((p) => p.requests);
    const peak = Math.max(1, ...values);
    // A bucket with no traffic still draws a 1px stub, so the day reads as
    // "quiet" rather than as a gap in the data.
    const bars = values.map((v) => (v > 0 ? Math.max(12, Math.round((v / peak) * 100)) : 6));
    return { bars, peak };
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        aria-hidden
        className={cn("h-6 rounded bg-muted/40", className)}
      />
    );
  }

  const total = points.reduce((n, p) => n + p.requests, 0);

  return (
    <div
      role="img"
      aria-label={`Last 24 hours: ${total.toLocaleString()} requests, peak ${peak.toLocaleString()} in one hour`}
      title={`Last 24 hours — peak ${peak.toLocaleString()} requests/hour`}
      className={cn("flex h-6 items-end gap-px", className)}
    >
      {bars.map((height, i) => (
        <span
          key={i}
          aria-hidden
          className="flex-1 rounded-sm bg-muted-foreground/35"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
