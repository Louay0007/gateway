"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeftRight,
  BadgeCheck,
  Check,
  CircleDollarSign,
  CreditCard,
  Infinity,
  Landmark,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Clock,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, PanelSkeleton, RefreshingBar } from "@/components/dashboard/states";
import { PaywallState } from "@/components/dashboard/paywall-state";
import { SpendMeter } from "@/components/dashboard/spend-meter";
import { PromptMeters } from "@/components/dashboard/prompt-meter";
import { StatCard } from "@/components/dashboard/stat-card";
import { apiSend, useApi } from "@/lib/api/use-api";
import type {
  PlanListResponse,
  SubscriptionBundle,
  PaymentHistoryItem,
} from "@/lib/api/types";
import { centsDt, centsUsd, compact, usd, usdToTnd } from "@/lib/dashboard/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Per-model token pricing from prices/models.yaml.
 * Mirrored for the client component since we cannot read YAML at runtime.
 */
const MODEL_PRICES: Record<string, { input: number; output: number; label: string }> = {
  fast: { input: 1.00, output: 5.00, label: "Fast (Haiku 5.5)" },
  smart: { input: 3.00, output: 15.00, label: "Smart (Sonnet 5.5)" },
  frontier: { input: 15.00, output: 75.00, label: "Frontier (Opus 5.5)" },
};

function usdPerMtok(usd: number): string {
  return `$${usd.toFixed(2)} / MTok`;
}

/**
 * BillingView — plan, spend and the exits, live.
 *
 * Redesigned with prominent D17 payment method branding, emerald/gray palette,
 * and detailed plan comparison table.
 */
export function BillingView() {
  const router = useRouter();
  const search = useSearchParams();

  const bundle = useApi<SubscriptionBundle>("/api/subscription");
  const catalog = useApi<PlanListResponse>("/api/plans");

  const [changeOpen, setChangeOpen] = React.useState(false);
  const [cancelMode, setCancelMode] = React.useState<"period" | "now" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const justPaid = search.get("state") === "active";

  const b = bundle.data;
  const plan = b?.plan ?? null;
  const plans = catalog.data?.plans ?? [];
  const hasPlan = b ? b.state !== "no_subscription" : true;

  /**
   * Confirm an active plan independently of `?state=active`.
   *
   * A D17 payment is approved by STAFF, minutes or hours after the customer
   * left the checkout page. They cannot be handed a query param at the moment
   * it matters — they simply open billing later and expect to see where they
   * stand. So the confirmation is derived from the data: an active
   * subscription whose latest payment is `paid`.
   *
   * Gated on the payment being `paid` rather than merely active so this
   * cannot duplicate the pending/rejected banners further down, which own
   * every non-active state.
   */
  const showActiveConfirmation =
    !justPaid &&
    b?.state === "active" &&
    b.d17PaymentStatus === "paid";

  const renews = b?.subscription?.currentPeriodEnd
    ? new Date(b.subscription.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  const isTrial = b?.subscription?.status === 'trialing';
  // While the trial window is still open the renew button is HIDDEN, not
  // merely disabled: there is nothing to renew yet, and the paid flow opens
  // the moment the trial ends. `renews` carries the end date for the note
  // that replaces the button.
  const trialActive =
    isTrial &&
    !!b?.subscription?.currentPeriodEnd &&
    Date.now() < new Date(b.subscription.currentPeriodEnd).getTime();
  const isRenewableNow = (() => {
    if (!b?.subscription || !hasPlan) return true;
    // Trial: once it is over (or has no end date) renewal is open at once —
    // visibility during the window is handled by `trialActive` above.
    if (isTrial) return true;
    if (!['active', 'past_due', 'paused'].includes(b.subscription.status)) return true;
    if (!b.subscription.currentPeriodEnd) return true;
    const end = new Date(b.subscription.currentPeriodEnd).getTime();
    return Date.now() >= end - 2 * 86400000;
  })();
  const renewalOpensLabel = b?.subscription?.currentPeriodEnd
    ? new Date(new Date(b.subscription.currentPeriodEnd).getTime() - 2 * 86400000).toLocaleDateString(
        "en-US",
        { month: "long", day: "numeric", timeZone: "UTC" },
      )
    : null;

  function refresh() {
    bundle.reload();
    catalog.reload();
  }

  async function beginCheckout(planCode: string, method?: "d17") {
    setBusy(planCode);
    const result = await apiSend<{ checkoutUrl: string }>("/api/checkout", {
      body: { planCode, ...(method ? { method } : {}) },
    });
    setBusy(null);

    if ("error" in result) {
      toast.error(result.error.message);
      return;
    }
    router.push(result.data.checkoutUrl);
  }

  async function changePlan(planCode: string) {
    setBusy("change");
    const result = await apiSend<{ plan: unknown }>(
      "/api/subscription/change-plan",
      { body: { planCode } },
    );
    setBusy(null);
    setChangeOpen(false);

    if ("error" in result) {
      toast.error(result.error.message);
      return;
    }
    refresh();
    toast.success(
      "Plan changed. Your gateway limits are already live; the new price applies at renewal.",
    );
  }

  async function cancel(mode: "period" | "now") {
    setBusy("cancel");
    const result = await apiSend<{ state: string; providerError?: string }>(
      "/api/subscription/cancel",
      { body: { atPeriodEnd: mode === "period" } },
    );
    setBusy(null);
    setCancelMode(null);

    if ("error" in result) {
      toast.error(result.error.message);
      return;
    }
    refresh();
    if (result.data.providerError) {
      toast.error(
        "Access was cut, but the payment provider rejected the cancellation. Our team has to finish it by hand.",
      );
      return;
    }
    toast.success(
      mode === "period"
        ? "Subscription will cancel at the end of the period. Access continues until then."
        : "Subscription canceled. Keys stay valid for re-subscribing, but traffic is cut.",
    );
  }

  async function resume() {
    setBusy("resume");
    const result = await apiSend<{ state: string }>("/api/subscription/resume");
    setBusy(null);

    if ("error" in result) {
      toast.error(result.error.message);
      refresh();
      return;
    }
    refresh();
    toast.success("Subscription resumed. It will renew as normal.");
  }

  // ── States ───────────────────────────────────────────────────────────
  if (bundle.loading) return <PanelSkeleton rows={4} />;
  if (bundle.error) return <ErrorState error={bundle.error} onRetry={bundle.reload} />;
  if (!b) return null;

  return (
    <>
      <RefreshingBar show={bundle.refreshing} />

      {!hasPlan ? (
        <PaywallState
          plans={plans}
          lang="en"
          onCheckout={(planCode) => void beginCheckout(planCode)}
          disabled={busy !== null}
        />
      ) : null}

      {justPaid ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="size-5 text-emerald-600" />
            <p className="text-sm">
              <span className="font-medium">Payment received.</span> Your gateway
              limits are live.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* The banner above needs ?state=active, which the checkout success page
          links to. Someone who arrives here another way — a bookmark, the nav
          link, a refresh after approving on a second device — is equally
          entitled to be told the plan is live, so an ACTIVE subscription with a
          recently-paid D17 row confirms itself here too. `justPaid` wins so the
          banner still fires on a plan with no payment row (trial, dev). */}
      {showActiveConfirmation ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="size-5 text-emerald-600" />
            <p className="text-sm">
              <span className="font-medium">Your plan is active.</span> Gateway
              limits are live.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {b.state === "past_due" ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <ShieldCheck className="size-5 text-destructive" />
            <p className="text-sm">
              <span className="font-medium">Payment failed.</span> Access
              continues during the grace period — submit a new payment to keep
              the plan active.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {b.entitlement?.status === "failed" ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <TriangleAlert className="size-5 text-destructive" />
            <p className="text-sm">
              <span className="font-medium">
                We couldn&apos;t apply your limits to the gateway.
              </span>{" "}
              Your access may be out of date while we retry.
              {b.entitlement.lastError ? (
                <span className="block text-xs text-muted-foreground">
                  {b.entitlement.lastError}
                </span>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {b.state === "pending" ? (
        <PendingBanner
          planName={plan?.name ?? "Your"}
          d17Status={b.d17PaymentStatus}
          subscriptionId={b.subscription?.id ?? null}
        />
      ) : null}

      {plan ? (
        <>
          {/* Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Spend this period"
              value={usdToTnd(b.usage.costCustomerUsd)}
              hint={`${plan.name} · ${centsDt(plan.includedSpendCents)} included`}
              icon={CircleDollarSign}
            />
            <StatCard
              label="Requests"
              value={b.usage.requests.toLocaleString()}
              hint="This billing period"
              icon={ArrowLeftRight}
            />
            <StatCard
              label="Tokens"
              value={compact(b.usage.inputTokens + b.usage.outputTokens)}
              hint={`${compact(b.usage.inputTokens)} in · ${compact(b.usage.outputTokens)} out`}
              icon={Landmark}
            />
            <StatCard
              label="Active keys"
              value={String(b.keys.active)}
              hint={`of ${b.keys.max ?? plan.maxKeys} allowed`}
              icon={CreditCard}
            />
          </div>

          {/* D17 Payment Method Hero Card */}
          <Card className="overflow-hidden border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 via-white to-gray-50 dark:from-emerald-950 dark:via-gray-900 dark:to-gray-950">
            <CardContent className="p-0">
              <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
                {/* D17 Logo */}
                <div className="flex justify-center md:justify-start">
                  <div className="relative size-24 overflow-hidden rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-800 shadow-sm md:size-28">
                    <Image
                      src="/images/d17-logo.webp"
                      alt="D17 DigiPost Bank"
                      fill
                      className="object-contain p-2"
                      priority
                    />
                  </div>
                </div>

                {/* D17 Info */}
                <div className="text-center md:text-left">
                  <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Pay with D17</h3>
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                      La Poste Tunisia
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    Transfer via DigiPost Bank (D17) at any La Poste counter or through the D17 mobile app. 
                    Proof of payment is verified manually — usually within hours.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500 dark:text-gray-400 md:justify-start">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      Secure manual verification
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      Usually confirmed within hours
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BadgeCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      No credit card required
                    </span>
                  </div>
                </div>

                {/* Action Button */}
                <div className="flex justify-center md:justify-end">
                  {trialActive ? (
                    <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium px-4 py-3">
                      Free trial active until{" "}
                      {b?.subscription?.currentPeriodEnd
                        ? new Date(b.subscription.currentPeriodEnd).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          })
                        : "your trial end date"}
                      {" "}— renewal opens when the trial ends.
                    </span>
                  ) : (
                    <Button
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-700 md:w-auto md:px-8"
                      size="lg"
                      disabled={busy !== null || !isRenewableNow}
                      title={
                        !isRenewableNow
                          ? `Renewal opens ${renewalOpensLabel} — 2 days before your period ends.`
                          : undefined
                      }
                      onClick={() => void beginCheckout(plan.code, "d17")}
                    >
                      <CreditCard className="mr-2 size-4" />
                      {busy
                        ? "Opening checkout…"
                        : hasPlan
                          ? isRenewableNow
                            ? "Renew with D17"
                            : `Renews ${renews ?? "next period"}`
                          : "Pay with D17"}
                    </Button>
                  )}
                </div>
              </div>

              {/* How it works strip */}
              <div className="border-t border-emerald-100 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 px-6 py-4">
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">1</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Start checkout</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Get your unique transfer amount</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">2</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Transfer via D17</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">At La Poste or D17 app</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">3</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Submit proof</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Authorization number activates your plan</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Current Plan & Usage */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {plan.name}
                      <Badge
                        variant={
                          b.subscription?.cancelAtPeriodEnd ? "outline" : "secondary"
                        }
                        className={b.subscription?.cancelAtPeriodEnd ? "" : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/70"}
                      >
                        {b.subscription?.cancelAtPeriodEnd
                          ? "Cancels at period end"
                          : statusLabel(b.state)}
                      </Badge>
                    </CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="flex items-baseline justify-end gap-1 text-2xl font-semibold tabular-nums">
                      {centsDt(plan.priceCents)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{plan.interval}
                      </span>
                    </p>
                    {renews ? (
                      <p className="text-xs text-muted-foreground">
                        {b.subscription?.cancelAtPeriodEnd ? "Access until" : "Renews"}{" "}
                        {renews}
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6">
                <PromptMeters
                  promptsByModel={b.usage.promptsByModel ?? {}}
                  promptLimits={plan.promptLimits ?? {}}
                />

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Spend this period</span>
                    <span className="tabular-nums">
                      {usdToTnd(b.usage.costCustomerUsd)} of{" "}
                      {centsDt(plan.includedSpendCents)}
                    </span>
                  </div>
                  <SpendMeter
                    spentUsd={b.usage.costCustomerUsd}
                    includedCents={plan.includedSpendCents}
                    hardCapCents={plan.hardCapCents}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    First {centsUsd(plan.includedSpendCents)} of usage each
                    period is included. Beyond that, usage bills at{" "}
                    {(plan.rateMultiplierBps / 10000).toFixed(2)}× upstream
                    cost. The gateway stops traffic at{" "}
                    {centsUsd(plan.hardCapCents ?? 0)} for this period.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Limit label="Requests / min" value={plan.rpmLimit?.toLocaleString() ?? "—"} />
                  <Limit label="Tokens / min" value={compact(plan.tpmLimit ?? 0)} />
                  <Limit
                    label="Concurrency"
                    value={plan.maxConcurrentRequests?.toLocaleString() ?? "—"}
                  />
                  <Limit label="API keys" value={plan.maxKeys.toLocaleString()} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChangeOpen(true)}
                  >
                    <ArrowLeftRight />
                    Change plan
                  </Button>
                  {b.subscription?.cancelAtPeriodEnd ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === "resume"}
                      onClick={() => void resume()}
                    >
                      <BadgeCheck />
                      {busy === "resume" ? "Resuming…" : "Resume subscription"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCancelMode("period")}
                      >
                        Cancel at period end
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCancelMode("now")}
                      >
                        Cancel immediately
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CircleDollarSign className="size-4" />
                    Usage math
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <Row label="Upstream cost" value={usdToTnd(b.usage.costUpstreamUsd)} />
                  <Row label="Your cost" value={usdToTnd(b.usage.costCustomerUsd)} />
                  <Row
                    label="Plan multiplier"
                    value={`${(plan.rateMultiplierBps / 10000).toFixed(2)}×`}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Both figures come from the same ledger rows, so the gap
                    between them is exactly what you were charged over what it
                    cost to serve.
                  </p>
                  {b.entitlement?.syncedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Limits last pushed to the gateway{" "}
                      {new Date(b.entitlement.syncedAt).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      .
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              <PaymentHistory />
            </div>
          </div>

          {/* Plan Comparison Table */}
          <PlanComparisonTable
            plans={plans}
            currentPlanCode={plan.code}
            onSelectPlan={(code) => void beginCheckout(code, "d17")}
            disabled={busy !== null}
          />
        </>
      ) : null}

      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>
              New limits apply immediately. The price difference is settled at
              renewal.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            {plans.map((p) => (
              <button
                key={p.code}
                type="button"
                disabled={busy !== null}
                onClick={() => void changePlan(p.code)}
                className={`grid gap-3 rounded-lg border p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 disabled:opacity-50 ${
                  p.code === plan?.code ? "border-emerald-500 dark:border-emerald-700 ring-1 ring-emerald-200 dark:ring-emerald-800" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {p.code === plan?.code ? <Badge className="bg-emerald-600 text-white">Current</Badge> : null}
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {centsDt(p.priceCents)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <ul className="grid gap-1 text-sm text-muted-foreground">
                  <li>{centsUsd(p.includedSpendCents)} included spend</li>
                  <li>{p.maxKeys} API keys</li>
                  <li>{p.rpmLimit} req/min</li>
                  <li>{compact(p.tpmLimit ?? 0)} tok/min</li>
                </ul>
              </button>
            ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Keep {plan?.name}</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelMode !== null}
        onOpenChange={(open) => !open && setCancelMode(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelMode === "period"
                ? `Cancel ${plan?.name} at period end?`
                : `Cancel ${plan?.name} immediately?`}
            </DialogTitle>
            <DialogDescription>
              {cancelMode === "period"
                ? `You keep full access until ${renews ?? "the end of the period"}. The subscription ends automatically after that — no further charges.`
                : "Access is cut now: the next request returns 429. Your keys stay valid, so re-subscribing restores service instantly."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Keep my plan</Button>} />
            <Button
              variant="destructive"
              disabled={busy === "cancel"}
              onClick={() => cancelMode && void cancel(cancelMode)}
            >
              {cancelMode === "period" ? "Cancel at period end" : "Cancel now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * PlanComparisonTable — detailed side-by-side comparison of all plans.
 */
function PlanComparisonTable({
  plans,
  currentPlanCode,
  onSelectPlan,
  disabled,
}: {
  plans: PlanListResponse["plans"];
  currentPlanCode: string;
  onSelectPlan: (code: string) => void;
  disabled: boolean;
}) {
  if (plans.length === 0) return null;

  const features = [
    { key: "price", label: "Monthly price", getValue: (p: typeof plans[0]) => centsDt(p.priceCents) },
    { key: "fast", label: "Fast prompts (Haiku 5.5)", getValue: (p: typeof plans[0]) => {
      const limit = (p.promptLimits as Record<string, number>)?.fast;
      return limit ? `${limit.toLocaleString()} / period` : "—";
    }},
    { key: "smart", label: "Smart prompts (Sonnet 5.5)", getValue: (p: typeof plans[0]) => {
      const limit = (p.promptLimits as Record<string, number>)?.smart;
      return limit ? `${limit.toLocaleString()} / period` : "—";
    }},
    { key: "frontier", label: "Frontier prompts", getValue: (p: typeof plans[0]) => {
      const limit = (p.promptLimits as Record<string, number>)?.frontier;
      return limit ? `${limit.toLocaleString()} / period` : "—";
    }, hideIfAllEmpty: true },
    { key: "rpm", label: "Requests / minute", getValue: (p: typeof plans[0]) => (p.rpmLimit ?? 0).toLocaleString() },
    { key: "tpm", label: "Tokens / minute", getValue: (p: typeof plans[0]) => compact(p.tpmLimit ?? 0) },
    { key: "keys", label: "API keys", getValue: (p: typeof plans[0]) => p.maxKeys.toString() },
    { key: "concurrency", label: "Max concurrency", getValue: (p: typeof plans[0]) => p.maxConcurrentRequests?.toString() ?? "—" },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-gray-50/50 dark:bg-gray-800/50">
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-5 text-emerald-600 dark:text-emerald-400" />
          Compare plans
        </CardTitle>
        <CardDescription>
          Prompt-based limits per model tier — choose the plan that fits your workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/30 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Feature</th>
                {plans.map((p) => (
                  <th
                    key={p.code}
                    className={cn(
                      "px-4 py-3 text-center",
                      p.code === "pro" && "bg-emerald-50/50 dark:bg-emerald-900/30",
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                      {p.code === currentPlanCode && (
                        <Badge className="bg-emerald-600 text-white text-xs">Current</Badge>
                      )}
                      {p.code === "pro" && p.code !== currentPlanCode && (
                        <Badge className="bg-emerald-600 text-white text-xs">Popular</Badge>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features
                .filter((feat) => {
                  if (!(feat as { hideIfAllEmpty?: boolean }).hideIfAllEmpty) return true;
                  return plans.some((p) => {
                    const val = feat.getValue(p);
                    return val != null && val !== "—" && val !== "";
                  });
                })
                .map((feat, i) => (
                <tr key={feat.key} className={i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/30 dark:bg-gray-800/50"}>
                  <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{feat.label}</td>
                  {plans.map((p) => (
                    <td
                      key={p.code}
                      className={cn(
                        "px-4 py-3 text-center tabular-nums text-gray-600 dark:text-gray-300",
                        p.code === "pro" && "bg-emerald-50/30 dark:bg-emerald-900/30 font-medium text-gray-900 dark:text-gray-100",
                      )}
                    >
                      {feat.getValue(p)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Token pricing row */}
              <tr className="border-t bg-white dark:bg-gray-900">
                <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">Token pricing</td>
                {plans.map((p) => (
                  <td key={p.code} className="px-4 py-3">
                    <div className="grid gap-1 text-xs">
                      {(p.models ?? []).length > 0 ? (
                        (p.models ?? []).map((modelId) => {
                          const price = MODEL_PRICES[modelId];
                          if (!price) return null;
                          return (
                            <div key={modelId} className="flex items-center justify-center gap-1">
                              <span className="text-gray-500 dark:text-gray-400">{price.label}:</span>
                              <span className="tabular-nums text-gray-600 dark:text-gray-300">
                                {usdPerMtok(price.input)} / {usdPerMtok(price.output)}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        Object.entries(MODEL_PRICES).map(([id, price]) => (
                          <div key={id} className="flex items-center justify-center gap-1">
                            <span className="text-gray-500 dark:text-gray-400">{price.label}:</span>
                            <span className="tabular-nums text-gray-600 dark:text-gray-300">
                              {usdPerMtok(price.input)} / {usdPerMtok(price.output)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                ))}
              </tr>
              {/* CTA row */}
              <tr className="border-t bg-gray-50/50 dark:bg-gray-800/50">
                <td className="px-4 py-4"></td>
                {plans.map((p) => (
                  <td key={p.code} className="px-4 py-4 text-center">
                    {p.code === currentPlanCode ? (
                      <Button variant="outline" size="sm" disabled className="w-full">
                        Current plan
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className={p.code === "pro" ? "bg-emerald-600 text-white hover:bg-emerald-700 w-full" : "w-full"}
                        variant={p.code === "pro" ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() => onSelectPlan(p.code)}
                      >
                        Choose {p.name}
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
      <div className="border-t bg-gray-50/50 dark:bg-gray-800/50 px-4 py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Prompt limits reset each billing period. Token prices shown are Zaino official USD rates (input / output per million tokens).
          Your DT cost is calculated at the current D17 exchange rate.
        </p>
      </div>
    </Card>
  );
}

/**
 * PendingBanner — compact notice for `incomplete` subscriptions.
 *
 * Rendered ABOVE the billing details so the user can still see their plan,
 * usage, keys and payment history while a D17 payment is in progress.
 * The old full-page takeover hid everything behind "Finish your payment",
 * which meant someone who opened billing to check their spend or cancel
 * saw none of it.
 *
 * Status-specific wording:
 *   proof_submitted   → awaiting staff verification
 *   rejected/expired  → that attempt ended; link to restart
 *   pending_payment   → checkout started but nothing sent yet
 *   null              → no payment row; link to checkout
 */
function PendingBanner({
  planName,
  d17Status,
  subscriptionId,
}: {
  planName: string;
  d17Status: string | null;
  subscriptionId: string | null;
}) {
  const checkoutHref = subscriptionId ? `/checkout/d17/${subscriptionId}` : null;
  const awaitingVerification = d17Status === "proof_submitted";
  const ended =
    d17Status === "rejected"
      ? "Your last proof was rejected."
      : d17Status === "expired"
        ? "Your payment window closed without a transfer."
        : null;

  const title = awaitingVerification
    ? "Payment pending verification"
    : ended ?? "Finish your payment to activate";

  const description = awaitingVerification
    ? `Your ${planName} plan will activate once we confirm your D17 transfer — usually within hours.`
    : ended
      ? "Start a new payment whenever you are ready."
      : `Complete the transfer on the checkout page to activate your ${planName} plan.`;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <Clock className="size-5 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm">
            <span className="font-medium">{title}</span>{" "}
            <span className="text-muted-foreground">{description}</span>
          </p>
        </div>
        {checkoutHref && !awaitingVerification ? (
          <Link
            href={checkoutHref}
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 dark:bg-gray-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800 dark:hover:bg-gray-600"
          >
            {ended ? "Start new payment" : "Continue payment"}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * PaymentHistory — every payment this account has made.
 */
function PaymentHistory() {
  const { data, error, loading, reload } = useApi<{
    payments: PaymentHistoryItem[];
  }>("/api/billing/payments");

  const payments = data?.payments ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="size-4" />
              Payment history
            </CardTitle>
            <CardDescription>
              Transfers you sent us, and what happened to them.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={reload}
            aria-label="Refresh payment history"
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {loading ? (
          <div className="grid gap-2" aria-hidden>
            <div className="h-10 rounded-lg bg-muted" />
            <div className="h-10 rounded-lg bg-muted" />
          </div>
        ) : error ? (
          <p role="alert" className="text-xs text-destructive">
            {error.message}
          </p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No payments yet. Your first transfer will appear here as soon as
            checkout creates it.
          </p>
        ) : (
          payments.map((p) => (
            <div
              key={p.id}
              className="grid gap-1 rounded-lg border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{p.planName}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">
                    {p.amount} DT
                  </span>
                  <Badge variant={paymentStatusVariant(p.status)}>
                    {paymentStatusLabel(p.status)}
                  </Badge>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {paymentStatusSentence(p)}
              </p>
              {p.rejectReason ? (
                <p className="text-xs text-destructive">{p.rejectReason}</p>
              ) : null}
              {p.flaggedReview && p.status === "proof_submitted" ? (
                <p className="text-xs text-muted-foreground">
                  Under enhanced review — this usually takes a little longer.
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function paymentStatusVariant(
  status: string,
): "secondary" | "destructive" | "outline" | "default" {
  if (status === "paid") return "secondary";
  if (status === "proof_submitted") return "default";
  if (status === "rejected" || status === "expired") return "destructive";
  return "outline";
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Verified";
    case "proof_submitted":
      return "Being checked";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Window expired";
    case "pending_payment":
      return "Awaiting payment";
    default:
      return status;
  }
}

function paymentStatusSentence(p: PaymentHistoryItem): string {
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" }) : null;

  switch (p.status) {
    case "paid":
      return `Verified on ${when(p.verifiedAt) ?? "—"}.`;
    case "proof_submitted":
      return `Submitted ${when(p.submittedAt) ?? "—"}. We are checking it against the D17 app — usually within hours.`;
    case "rejected":
      return `Rejected ${when(p.verifiedAt) ?? "—"}. You can submit a new proof from the checkout page.`;
    case "expired":
      return `The payment window closed on ${when(p.expiresAt) ?? "—"} without a transfer. Start checkout again.`;
    default:
      return `Opened ${when(p.createdAt) ?? "—"} — transfer ${p.amount} DT by ${when(p.expiresAt) ?? "the deadline"}.`;
  }
}

function statusLabel(state: SubscriptionBundle["state"]): string {
  switch (state) {
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    case "pending":
      return "Payment pending";
    case "canceled":
      return "Canceled";
    case "paused":
      return "Paused";
    default:
      return "No plan";
  }
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}