"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, ClipboardList, KeyRound, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { SpendMeter } from "@/components/dashboard/spend-meter";
import {
  ErrorState,
  PanelSkeleton,
  PaywallState,
  RefreshingBar,
} from "@/components/dashboard/states";
import { OverviewKeysPanel } from "@/components/dashboard/overview-keys-panel";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { UsageAreaChart } from "@/components/dashboard/usage-area-chart";
import { OnboardingFlow } from "@/components/dashboard/onboarding-flow";
import { useApi } from "@/lib/api/use-api";
import type {
  KeyView,
  SubscriptionBundle,
  UsagePageResponse,
  UsageSeriesResponse,
} from "@/lib/api/types";
import { centsUsd, compact, rangeLabel, relativeTime, usd } from "@/lib/dashboard/format";

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

  const [onboardingDismissed, setOnboardingDismissed] = React.useState(false);

  // Check localStorage on mount to respect previous dismissal
  React.useEffect(() => {
    try {
      setOnboardingDismissed(
        localStorage.getItem("zaino-onboarding-dismissed") === "true",
      );
    } catch {
      // localStorage may be unavailable (SSR, privacy mode). Default to showing.
    }
  }, []);

  const b = bundle.data;
  const plan = b?.plan ?? null;
  const keys = keysApi.data?.keys ?? [];
  const noPlan = b?.state === "no_subscription";
  const noKeys = keys.length === 0;

  // Show onboarding when user has no plan OR no keys, and hasn't dismissed it
  const showOnboarding =
    !onboardingDismissed &&
    !bundle.loading &&
    !keysApi.loading &&
    b !== null &&
    (noPlan || noKeys);

  if (bundle.loading || keysApi.loading) return <PanelSkeleton rows={4} />;
  if (bundle.error) return <ErrorState error={bundle.error} onRetry={bundle.reload} />;
  if (keysApi.error) return <ErrorState error={keysApi.error} onRetry={keysApi.reload} />;
  if (!b) return null;

  // When onboarding should show, render it instead of the normal dashboard
  if (showOnboarding) {
    return (
      <>
        <RefreshingBar show={bundle.refreshing || keysApi.refreshing} />
        <OnboardingFlow
          bundle={b}
          keys={keys}
          onComplete={() => {
            setOnboardingDismissed(true);
            // Reload data in case key was created during onboarding
            keysApi.reload();
            bundle.reload();
          }}
        />
      </>
    );
  }

  return (
    <>
      <RefreshingBar show={bundle.refreshing || keysApi.refreshing} />

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Spend this period"
          value={usd(b.usage.costCustomerUsd)}
          hint={
            plan ? `${plan.name} · ${centsUsd(plan.includedSpendCents)} included` : "No plan"
          }
          icon={Wallet}
          footer={
            plan ? (
              <SpendMeter
                spentUsd={b.usage.costCustomerUsd}
                includedCents={plan.includedSpendCents}
                hardCapCents={plan.hardCapCents}
              />
            ) : undefined
          }
        />
        <StatCard
          label="Requests"
          value={b.usage.requests.toLocaleString()}
          hint="This billing period"
          icon={ClipboardList}
        />
        <StatCard
          label="Tokens"
          value={compact(b.usage.inputTokens + b.usage.outputTokens)}
          hint={`${compact(b.usage.inputTokens)} in · ${compact(b.usage.outputTokens)} out`}
          icon={BarChart3}
        />
        <StatCard
          label="Active keys"
          value={String(keys.length)}
          hint={plan ? `of ${plan.maxKeys} allowed on ${plan.name}` : undefined}
          icon={KeyRound}
        />
      </div>

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
          requestsThisPeriod={b.usage.requests}
        />
        <RecentActivity rows={recent.data?.rows ?? []} keys={keys} />
      </div>

      <p className="text-xs text-muted-foreground">
        {b.entitlement?.syncedAt
          ? `Entitlements last synced ${relativeTime(b.entitlement.syncedAt)}`
          : "Entitlements have not synced yet"}
        {b.subscription?.currentPeriodEnd
          ? ` · Period renews ${new Date(b.subscription.currentPeriodEnd).toLocaleDateString(
              "en-US",
              { month: "long", day: "numeric", timeZone: "UTC" },
            )}`
          : ""}
        .
      </p>
    </>
  );
}