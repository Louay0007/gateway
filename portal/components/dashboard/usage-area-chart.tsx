"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { compact } from "@/lib/dashboard/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { UsageSeriesPoint } from "@/lib/api/types";

/**
 * UsageAreaChart — requests and tokens over time, from a REAL series.
 *
 * Two series separated by FORM, not luminance: requests is a dashed stroke
 * with no fill, tokens is a filled gradient area. That survives both themes
 * and colour blindness, which a hue difference does not.
 *
 * IT NO LONGER BUCKETS ANYTHING. The previous version received one page of
 * ledger rows (25), grouped them by day in the browser, and printed that
 * page's min/max as a date range. It could never show more than a page of
 * days, and a quiet day simply disappeared — the chart drew a lie by
 * omission with no error anywhere.
 *
 * The points now arrive from `GET /api/usage/summary`, already bucketed and
 * already dense: every bucket in the window is present, and a day with no
 * traffic is an explicit zero. The range label is the SERVER's window, not
 * the extent of whatever rows happened to arrive, so it describes the data
 * the customer selected rather than the data that fit in a page.
 */
export function UsageAreaChart({
  points = [],
  bucket = "day",
  rangeLabel,
  emptyNote,
}: {
  points?: UsageSeriesPoint[];
  bucket?: "day" | "hour";
  /** The server's resolved window, e.g. "Oct 1 → Oct 31". */
  rangeLabel?: string | null;
  emptyNote?: string;
}) {
  const data = useMemo(
    () =>
      points.map((p) => ({
        date: p.bucket,
        requests: p.requests,
        tokens: p.inputTokens + p.outputTokens,
      })),
    [points],
  );

  // chart-2/chart-3 sit mid-scale in both themes; chart-1 (87% lightness)
  // disappears on white.
  const chartConfig = {
    requests: { label: "Requests", color: "var(--chart-3)" },
    tokens: { label: "Tokens", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const perLabel = bucket === "hour" ? "hour" : "day";
  const fmtTick = (value: string) =>
    bucket === "hour"
      ? new Date(value).toLocaleTimeString("en-US", {
          hour: "numeric",
          timeZone: "UTC",
        })
      : new Date(value).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });

  // A series of all zeros is honest but not useful to plot — show the empty
  // state instead, while still naming the window that was checked.
  const allZero = data.every((d) => d.requests === 0 && d.tokens === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic</CardTitle>
        <CardDescription>
          {rangeLabel
            ? `Requests and tokens per ${perLabel} · ${rangeLabel}`
            : `Requests and tokens per ${perLabel}, from your ledger`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 || allZero ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              No requests in this window.
            </p>
            {emptyNote ? (
              <p className="max-w-sm text-xs text-muted-foreground">{emptyNote}</p>
            ) : null}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
            <AreaChart
              data={data}
              margin={{ left: 4, right: 4, top: 8 }}
              accessibilityLayer
            >
              <defs>
                <linearGradient id="fillTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-tokens)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-tokens)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={fmtTick}
              />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                width={32}
                tickFormatter={(value: number) => compact(value)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(value: number) => compact(value)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      bucket === "hour"
                        ? new Date(String(value)).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            timeZone: "UTC",
                          })
                        : new Date(String(value)).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          })
                    }
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                yAxisId="left"
                dataKey="requests"
                type="monotone"
                stroke="var(--color-requests)"
                strokeDasharray="4 4"
                fill="none"
                strokeWidth={2}
              />
              <Area
                yAxisId="right"
                dataKey="tokens"
                type="monotone"
                stroke="var(--color-tokens)"
                fill="url(#fillTokens)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
