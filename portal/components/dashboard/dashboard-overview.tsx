"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, CalendarClock, Gauge, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  QuotaExhaustedBanner,
  QuotaMeters,
} from "@/components/dashboard/quota-meter";
import {
  ErrorState,
  PanelSkeleton,
  PaywallState,
  RefreshingBar,
} from "@/components/dashboard/states";
import { OverviewKeysPanel } from "@/components/dashboard/overview-keys-panel";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { UsageAreaChart } from "@/components/dashboard/usage-area-chart";
import { useApi } from "@/lib/api/use-api";
import type {
  KeyView,
  SubscriptionBundle,
  UsagePageResponse,
  UsageSeriesResponse,
} from "@/lib/api/types";
import { compact, rangeLabel, relativeTime } from "@/lib/dashboard/format";

/**
 * /dashboard — the overview, live.
 *
 * Two requests, because `/api/subscription` returns the plan, the bundle
 * and a key COUNT (`keys: {active, max}`) but not the key LIST. Rather
 * than widen the bundle — which every other caller would then pay for —
 * the list comes from `GET /api/keys`, the same call the keys page makes.
 *
 * The chart is fed by `GET /api/usage/summary`, a real server-bucketed,
 * dense series (Step 8). It used to bucket the first page of ledger rows
 * client-side and label that page's extent a "date range", which could
 * never show more than a page of days and hid quiet days entirely.
 */
export function DashboardOverview() {
  const bundle = useApi<SubscriptionBundle>("/api/subscription");
  const keysApi = useApi<{ keys: KeyView[] }>("/api/keys");
  const recent = useApi<UsagePageResponse>("/api/usage?page=1&pageSize=8");
  const series = useApi<UsageSeriesResponse>("/api/usage/summary?bucket=day");

  const b = bundle.data;
  const plan = b?.plan ?? null;
  const keys = keysApi.data?.keys ?? [];
  const noPlan = b?.state === "no_subscription";

  // Token-only view: blended tokens are the only quota, so the summary is
  // budgets vs used per alias — no spend, prompt or key KPIs.
  const tokenLimits = plan?.tokenLimits ?? {};
  const tokensByModel = b?.tokensByModel ?? {};
  const aliases = plan?.models ?? [];
  const usedTokens = aliases.reduce((sum, a) => sum + (tokensByModel[a] ?? 0), 0);
  const budgeted = aliases
    .map((a) => Number(tokenLimits[a] ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const totalBudget = budgeted.reduce((sum, n) => sum + n, 0);
  const hasBudget = budgeted.length > 0;
  const remainingTokens = hasBudget ? Math.max(0, totalBudget - usedTokens) : null;
  const periodEnd = b?.period.end ?? null;
  // 0025: daily quotas — the "renews" card counts down to midnight Tunis
  // time (tomorrow), not the billing period end. b.period.end is the Tunis
  // day end for daily rows.
  const periodEndLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

  if (bundle.loading || keysApi.loading) return <PanelSkeleton rows={4} />;
  if (bundle.error) return <ErrorState error={bundle.error} onRetry={bundle.reload} />;
  if (keysApi.error) return <ErrorState error={keysApi.error} onRetry={keysApi.reload} />;
  if (!b) return null;

  return (
    <>
      <RefreshingBar show={bundle.refreshing || keysApi.refreshing} />

      {b.plan ? (
        <QuotaExhaustedBanner
          tokensByModel={b.tokensByModel ?? {}}
          tokenLimits={b.plan.tokenLimits ?? {}}
          entitled={b.plan.models ?? []}
          resetDate={b.subscription?.currentPeriodEnd ?? b.period.end}
        />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Here is what your gateway has been doing today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/usage" />}
          >
            <BarChart3 />
            View usage
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/keys" />}
          >
            <KeyRound />
            Manage keys
          </Button>
        </div>
      </div>

      {noPlan ? (
        <PaywallState
          cta={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/dashboard/billing" />}
            >
              Choose a plan
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Tokens used"
          value={compact(usedTokens)}
          hint={`${compact(b.usage.inputTokens)} in · ${compact(b.usage.outputTokens)} out`}
          icon={BarChart3}
        />
        <StatCard
          label="Tokens remaining"
          value={
            remainingTokens === null ? "Unlimited" : compact(remainingTokens)
          }
          hint={
            hasBudget
              ? `of ${compact(totalBudget)} today — resets at midnight Tunis time`
              : "No token budget on this plan"
          }
          icon={Gauge}
        />
        <StatCard
          label={b.subscription?.cancelAtPeriodEnd ? "Access until" : "Resets"}
          value={periodEndLabel}
          hint={plan ? `${plan.name} · daily` : "No plan"}
          icon={CalendarClock}
        />
      </div>

      {plan ? (
        <Card>
          <CardHeader>
            <CardTitle>Token budgets</CardTitle>
            <CardDescription>
              Each model tier stops when its blended-token budget is spent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuotaMeters
              tokensByModel={tokensByModel}
              tokenLimits={tokenLimits}
            />
          </CardContent>
        </Card>
      ) : null}

      <UsageAreaChart
        points={series.data?.points ?? []}
        bucket={series.data?.bucket ?? "day"}
        rangeLabel={rangeLabel(series.data?.from, series.data?.to)}
        emptyNote="Once your key makes its first call, the daily trend appears here."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <OverviewKeysPanel
          keys={keys}
          planName={plan?.name ?? "your plan"}
          maxKeys={plan?.maxKeys ?? keys.length}
        />
        <RecentActivity rows={recent.data?.rows ?? []} keys={keys} />
      </div>

      <p className="text-xs text-muted-foreground">
        {b.entitlement?.syncedAt
          ? `Entitlements last synced ${relativeTime(b.entitlement.syncedAt)}`
          : "Entitlements have not synced yet"}
        {b.period.end
          ? ` · Daily budgets reset ${new Date(b.period.end).toLocaleDateString(
              "en-US",
              { month: "long", day: "numeric", timeZone: "UTC" },
            )} at midnight Tunis time`
          : ""}
        .
      </p>
    </>
  );
}