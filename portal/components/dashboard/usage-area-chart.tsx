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
import type { UsageRowView } from "@/lib/api/types";

/**
 * UsageAreaChart — requests and tokens over time.
 *
 * Two series separated by FORM, not luminance: requests is a dashed stroke
 * with no fill, tokens is a filled gradient area. That survives both
 * themes and colour blindness, which a hue difference does not.
 *
 * THE CHART IS FED BY REAL LEDGER ROWS NOW. The previous version called
 * `buildSeries(30)` — a deterministic but invented weekday rhythm with a
 * launch spike — because `/api/subscription` returns period totals, not a
 * day-bucketed series. Inventing a trend on a billing dashboard is the
 * worst kind of placeholder: it is indistinguishable from real data to
 * anyone glancing at it.
 *
 * Rows arrive newest-first and ungrouped, so they are bucketed by day here
 * and labelled with what the data actually covers. `emptyNote` is shown
 * when there is nothing to plot, and says why — a daily summary endpoint
 * (`/api/usage?bucket=day`) is the correct follow-up rather than more
 * client-side arithmetic.
 */
export function UsageAreaChart({
  rows = [],
  emptyNote,
}: {
  rows?: UsageRowView[];
  emptyNote?: string;
}) {
  const data = useMemo(() => {
    if (rows.length === 0) return [];
    const byDay = new Map<string, { date: string; requests: number; tokens: number }>();
    for (const row of rows) {
      const day = row.occurredAt.slice(0, 10);
      const entry = byDay.get(day) ?? { date: day, requests: 0, tokens: 0 };
      entry.requests += 1;
      entry.tokens += row.inputTokens + row.outputTokens;
      byDay.set(day, entry);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // chart-2/chart-3 sit mid-scale in both themes; chart-1 (87% lightness)
  // disappears on white.
  const chartConfig = {
    requests: { label: "Requests", color: "var(--chart-3)" },
    tokens: { label: "Tokens", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const rangeLabel =
    data.length > 0
      ? `${data[0]!.date} → ${data[data.length - 1]!.date}`
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic</CardTitle>
        <CardDescription>
          {rangeLabel
            ? `Requests and tokens per day · ${rangeLabel}`
            : "Requests and tokens per day, from your ledger"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              No requests to plot yet.
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
                tickFormatter={(value: string) =>
                  new Date(value).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })
                }
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
                      new Date(String(value)).toLocaleDateString("en-US", {
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