"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarClock,
  Coins,
  Flame,
  Gauge,
  KeyRound,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { QuotaPoolMeter } from "@/components/dashboard/quota-meter";
import {
  ErrorState,
  PanelSkeleton,
  PaywallState,
  RefreshingBar,
} from "@/components/dashboard/states";
import { OverviewKeysPanel } from "@/components/dashboard/overview-keys-panel";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { UsageAreaChart } from "@/components/dashboard/usage-area-chart";
import { useApi } from "@/lib/api/use-api";
import { useShellIdentity } from "@/components/dashboard/shell-identity";
import type {
  KeyView,
  UsagePageResponse,
  UsageSeriesResponse,
} from "@/lib/api/types";
import { compact, rangeLabel, relativeTime, usd } from "@/lib/dashboard/format";
import { daysRemainingAtRate } from "@/lib/dashboard/quota-tone";

/**
 * /dashboard — the overview, live.
 *
 * THE BUNDLE COMES FROM THE SHELL, NOT A FOURTH FETCH. `/api/subscription`
 * was requested here AND by `ShellIdentityProvider`, so every dashboard load
 * paid for the same query twice and the two copies could disagree mid-flight
 * (one refreshed, one stale). The shell already holds the bundle for the
 * header's spend figure; reading it from context removes a request and makes
 * the header and the page show one number.
 *
 * The key LIST still comes from `GET /api/keys` because the bundle carries
 * only a key COUNT (`keys: {active, max}`) — widening the bundle would make
 * every caller pay for a list they do not render.
 *
 * The chart is fed by `GET /api/usage/summary`, a real server-bucketed,
 * dense series. It used to bucket the first page of ledger rows client-side
 * and label that page's extent a "date range", which could never show more
 * than a page of days and hid quiet days entirely.
 */
export function DashboardOverview() {
  // One bundle for the whole shell (header + page). `refresh()` re-reads it.
  const {
    bundle: shellBundle,
    loading: shellLoading,
    refreshing: shellRefreshing,
    refresh,
  } = useShellIdentity();
  const keysApi = useApi<{ keys: KeyView[] }>("/api/keys");
  const recent = useApi<UsagePageResponse>("/api/usage?page=1&pageSize=8");
  const series = useApi<UsageSeriesResponse>("/api/usage/summary?bucket=day");

  const b = shellBundle;
  const plan = b?.plan ?? null;
  const keys = keysApi.data?.keys ?? [];
  const noPlan = b?.state === "no_subscription";

  // Token-only view: blended tokens are the only quota.
  //
  // 0039: ONE POOL. The bundle resolves the plan's shared allowance and how
  // much of it is spent, so the summary reads those two numbers directly
  // instead of summing per-alias budgets — summing was the old split, and
  // it silently assumed every alias was entitled to its own slice.
  const poolTokens = b?.poolTokens ?? null;
  const poolUsed = b?.poolUsedTokens ?? 0;
  const hasBudget = typeof poolTokens === "number" && poolTokens > 0;
  const remainingTokens = hasBudget ? Math.max(0, poolTokens - poolUsed) : null;
  const periodEnd = b?.period.end ?? null;
  // 0038: quotas are monthly, so b.period.end is the end of the billing
  // period the budgets are measured over — not the end of a Tunis day.
  const periodEndLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

  // Days at the current average burn, derived from the bundle alone.
  const daysLeft = daysRemainingAtRate(
    poolTokens,
    poolUsed,
    b?.period.start ?? b?.subscription?.currentPeriodStart ?? null,
  );

  if (shellLoading || keysApi.loading) return <PanelSkeleton rows={4} />;
  if (keysApi.error) return <ErrorState error={keysApi.error} onRetry={keysApi.reload} />;
  if (!b) return null;

  return (
    <>
      <RefreshingBar show={shellRefreshing || keysApi.refreshing} />

      {/* THE ANSWER, above every panel. One sentence, one tone, one action.
          `noPlan` renders the paywall copy in the strip, so a customer
          without a subscription is oriented before they scroll. */}
      <StatusStrip
        poolTokens={b.poolTokens}
        poolUsedTokens={b.poolUsedTokens}
        periodStart={b.period.start ?? b.subscription?.currentPeriodStart ?? null}
        periodEnd={b.subscription?.currentPeriodEnd ?? b.period.end}
        noPlan={noPlan}
      />

      {/* Checklist first: a new account's job is a next step, not a
          dashboard reading zero. It renders nothing once complete. */}
      {plan ? (
        <GettingStarted
          hasPlan
          trial={{
            active: b?.subscription?.status === "trialing",
            daysRemaining: trialDaysLeft(b?.subscription?.currentPeriodEnd ?? null),
            tokens: b?.poolTokens != null ? compact(b.poolTokens) : null,
          }}
          keyCount={keys.filter((k) => !k.revokedAt).length}
          hasAnyRequest={(recent.data?.rows?.length ?? 0) > 0}
        />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Here is what your gateway has been doing this period.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={refresh}
            aria-label="Refresh dashboard"
            disabled={shellRefreshing}
          >
            <RefreshCw className={shellRefreshing ? "animate-spin" : undefined} />
          </Button>
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

      {/* FIVE cards, not four: a 4-column grid leaves the fifth alone on a
          second row at desktop width. Three columns fills both rows (3 + 2)
          and keeps the eye moving left-to-right. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Tokens used"
          value={compact(poolUsed)}
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
              ? `of ${compact(poolTokens)} this period — resets ${periodEndLabel}`
              : "No token budget on this plan"
          }
          icon={Gauge}
        />
        {/* WHEN, not just how much: the question the pool card raises. */}
        <StatCard
          label="Burn rate"
          value={
            daysLeft === null
              ? "—"
              : daysLeft <= 0
                ? "Out now"
                : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
          }
          hint={
            hasBudget && poolUsed > 0
              ? "at the current average rate"
              : "no usage this period yet"
          }
          icon={Flame}
        />
        {/* The promise the FAQ makes: what this period cost. One card, not
            a fourth headline — tokens remain the quota. */}
        <StatCard
          label="Cost this period"
          value={usd(b.usage.costCustomerUsd)}
          hint={`${(b.usage.requests ?? 0).toLocaleString()} requests`}
          icon={Coins}
        />
        <StatCard
          label={b.subscription?.cancelAtPeriodEnd ? "Access until" : "Resets"}
          value={periodEndLabel}
          hint={plan ? `${plan.name} · monthly` : "No plan"}
          icon={CalendarClock}
        />
      </div>

      {plan ? (
        <Card>
          <CardHeader>
            <CardTitle>Token budget</CardTitle>
            <CardDescription>
              One shared allowance across the models your plan unlocks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuotaPoolMeter
              poolTokens={b.poolTokens}
              poolUsedTokens={b.poolUsedTokens}
              entitled={plan.models ?? []}
              // 0043: the daily cap is enforced but was rendered only on
              // Billing, so a customer at the cap learned about it from a
              // 403. It belongs on the page they open.
              dailyCap={b.dailyTokenCap ?? null}
              dailyUsed={b.dailyUsedTokens ?? 0}
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
          ? ` · Monthly token budgets reset ${new Date(b.period.end).toLocaleDateString(
              "en-US",
              { month: "long", day: "numeric", timeZone: "UTC" },
            )}`
          : ""}
        .
      </p>
    </>
  );
}

/**
 * Whole days remaining until an ISO instant, or null when unknown.
 *
 * Rounded UP: a trial ending in 4 hours reads "1 day left", not "0", because
 * "0 days left" while the thing still works is alarming and wrong.
 */
function trialDaysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
