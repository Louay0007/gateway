"use client";

import Link from "next/link";
import {
  BarChart3,
  KeyRound,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { MetricRail } from "@/components/dashboard/metric-rail";
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
import { daysRemainingAtRate, quotaTone } from "@/lib/dashboard/quota-tone";

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
 *
 * READING ORDER, top to bottom, is the order a customer asks the questions:
 *
 *   1. "am I about to run out?"   → StatusStrip (one sentence, one action)
 *   2. "what do I do next?"       → GettingStarted (until it is all done)
 *   3. "what are the numbers?"    → MetricRail (one surface, four figures)
 *   4. "where did it go?"         → Traffic chart
 *   5. "what is wired up?"        → keys + recent activity, side by side
 *
 * The five stat cards that used to sit at step 3 are gone. Five bordered
 * boxes with an icon each is the hero-metric template: it spent ~120px and
 * five borders to say four numbers, and orphaned the fifth card on a second
 * row at every desktop width. The rail says the same four numbers on one
 * surface, and the budget bar — which used to be its own card repeating the
 * same two figures — is now the rail's footer.
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
  const periodEnd = b?.subscription?.currentPeriodEnd ?? b?.period.end ?? null;
  const periodStart = b?.period.start ?? b?.subscription?.currentPeriodStart ?? null;
  const periodEndLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

  // Days at the current average burn, derived from the bundle alone.
  const daysLeft = daysRemainingAtRate(poolTokens, poolUsed, periodStart);
  const tone = quotaTone(poolUsed, poolTokens);

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

      <PageHeader
        size="console"
        lede="What your gateway has done this period."
        actions={
          <>
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
          </>
        }
      />

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

      <MetricRail
        items={[
          {
            label: "Tokens used",
            value: compact(poolUsed),
            hint: `${compact(b.usage.inputTokens)} in · ${compact(b.usage.outputTokens)} out`,
            tone: tone === "blocked" ? "destructive" : "default",
          },
          {
            label: "Remaining",
            value: remainingTokens === null ? "Unlimited" : compact(remainingTokens),
            hint: hasBudget ? `of ${compact(poolTokens)} this period` : "No token budget",
            tone: tone === "warning" ? "warning" : "default",
          },
          {
            label: "Burn rate",
            value:
              daysLeft === null
                ? "—"
                : daysLeft <= 0
                  ? "Out now"
                  : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
            hint:
              hasBudget && poolUsed > 0
                ? "left at the current average"
                : "no usage this period yet",
            tone: daysLeft !== null && daysLeft <= 3 ? "warning" : "default",
          },
          {
            label: "Cost this period",
            value: usd(b.usage.costCustomerUsd),
            hint: `${(b.usage.requests ?? 0).toLocaleString()} requests`,
          },
        ]}
        footer={
          plan ? (
            <div className="grid gap-3">
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
              <p className="text-xs text-muted-foreground">
                {b.subscription?.cancelAtPeriodEnd ? "Access until" : "Resets"}{" "}
                {periodEndLabel} · {plan.name}
              </p>
            </div>
          ) : null
        }
      />

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
        {periodEnd ? ` · Monthly token budgets reset ${periodEndLabel}` : ""}.
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
