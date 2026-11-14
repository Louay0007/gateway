"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeftRight,
  BadgeCheck,
  Check,
  CreditCard,
  Landmark,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Clock,
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
import { PaymentMethodDialog } from "@/components/dashboard/payment-method-dialog";
import type { PlanSummary } from "@/lib/billing/state";
import { QuotaPoolMeter, QuotaExhaustedBanner } from "@/components/dashboard/quota-meter";
import { StatCard } from "@/components/dashboard/stat-card";
import { apiSend, useApi } from "@/lib/api/use-api";
import type {
  PlanListResponse,
  SubscriptionBundle,
  PaymentHistoryItem,
} from "@/lib/api/types";
import { compact, formatPlanPrice, usd } from "@/lib/dashboard/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Per-model token pricing from prices/models.yaml.
 * Mirrored for the client component since we cannot read YAML at runtime.
 */
/**
 * Per-model token pricing, in dollars per million tokens.
 *
 * LABELS ARE ALIAS-ONLY. They used to read "Fast (Haiku 5.5)", "Frontier
 * (Opus 5.5)", "Fable (GPT-6 Astra)" — the upstream vendor's model names,
 * rendered straight to customers. `CONTEXT.md` §1 makes the alias the
 * whole surface: it is what makes swapping the engine behind a tier a
 * config change instead of a breaking change, and it is why a customer's
 * invoice never has to be re-explained. Naming the engine also tells a
 * competitor exactly what we buy and at what cost.
 */
const MODEL_PRICES: Record<string, { input: number; output: number; label: string }> = {
  fast: { input: 1.00, output: 5.00, label: "Fast" },
  smart: { input: 3.00, output: 15.00, label: "Smart" },
  frontier: { input: 15.00, output: 75.00, label: "Frontier" },
  // Same rates as frontier by design (prices/models.yaml) — fable is a
  // second frontier-class route, not a cheaper one.
  fable: { input: 15.00, output: 75.00, label: "Fable" },
};

/** "1 November" from an ISO instant, in the sale's own timezone. */
function promoEndsLabel(endsAt: string): string {
  return new Date(endsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Tunis",
  });
}

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
  /** The plan the rail dialog is open for; null = closed. Every checkout
   *  trigger (hero, paywall, comparison table) funnels through here —
   *  the dialog is where D17 vs card gets chosen, BEFORE anything ships. */
  const [checkoutPlan, setCheckoutPlan] = React.useState<PlanSummary | null>(null);

  const justPaid = search.get("state") === "active";

  const b = bundle.data;
  const plan = b?.plan ?? null;
  const plans = catalog.data?.plans ?? [];
  const promo = plans.find((p) => p.promo)?.promo ?? plan?.promo ?? null;
  const hasPlan = b ? b.state !== "no_subscription" : true;

  // Token-only KPIs: blended tokens are the sole quota.
  //
  // 0039: ONE POOL — the bundle resolves the shared allowance and the spend
  // against it, so there is nothing to sum per alias any more.
  const poolTokens = b?.poolTokens ?? null;
  const poolUsed = b?.poolUsedTokens ?? 0;
  const hasBudget = typeof poolTokens === "number" && poolTokens > 0;
  const remainingTokens = hasBudget ? Math.max(0, poolTokens - poolUsed) : null;

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
  // 0038: the token budget is monthly, so the reset the customer reads has to
  // be the period end — not a midnight that never comes.
  const periodEndLabel = b?.period?.end
    ? new Date(b.period.end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  function refresh() {
    bundle.reload();
    catalog.reload();
  }

  /**
   * Open the payment-method dialog for a plan. No direct-to-provider
   * navigation happens here: the DODO rail must never ambush a customer
   * who expected to transfer dinars, and the reverse.
   */
  function openCheckout(planCode: string) {
    const target = plans.find((p) => p.code === planCode) ?? null;
    if (!target) return;
    setCheckoutPlan(target);
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

      {promo ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <p className="text-sm">
              <span className="font-medium">
                {promo.label}: {promo.percentOff}% off every plan.
              </span>{" "}
              {/* The date comes from the promo, not from a string — the old
                  copy said "Ends 1 Nov" forever, including after it ended
                  and on any future campaign with a different window. */}
              Ends {promoEndsLabel(promo.endsAt)}. The discount is applied
              automatically when you pay by D17.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!hasPlan ? (
        <PaywallState
          plans={plans}
          lang="en"
          onCheckout={(planCode) => openCheckout(planCode)}
          disabled={busy !== null}
        />
      ) : null}

      {justPaid ? (
        <Card className="border-success/40 bg-success/10">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="size-5 text-success" />
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
        <Card className="border-success/40 bg-success/10">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="size-5 text-success" />
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
          {/* Token KPIs — the only quota */}
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Tokens used"
              value={compact(poolUsed)}
              hint={`${compact(b.usage.inputTokens)} in · ${compact(b.usage.outputTokens)} out`}
              icon={ArrowLeftRight}
            />
            <StatCard
              label="Tokens remaining"
              value={remainingTokens === null ? "Unlimited" : compact(remainingTokens)}
              hint={
                remainingTokens === null
                  ? "No token budget on this plan"
                  : `of ${compact(poolTokens ?? 0)} this period — resets ${periodEndLabel}`
              }
              icon={Landmark}
            />
          </div>

          {/* D17 Payment Method Hero Card */}
          <Card className="overflow-hidden border-success/30 bg-gradient-to-br from-emerald-50 via-white to-muted from-success/10 dark:via-background dark:to-background">
            <CardContent className="p-0">
              <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
                {/* D17 Logo */}
                <div className="flex justify-center md:justify-start">
                  <div className="relative size-24 overflow-hidden rounded-xl border-2 border-success/30 bg-white shadow-sm md:size-28">
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
                    <h3 className="text-lg font-semibold text-foreground">Pay with D17 or card</h3>
                    <Badge className="bg-success text-white hover:bg-success/90">
                      La Poste Tunisia
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Prefer dinars? Transfer via DigiPost Bank (D17) at any La Poste
                    counter or through the D17 mobile app — staff verify it by hand.
                    Elsewhere, pay by card through Dodo at checkout.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground md:justify-start">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-success" />
                      Secure manual verification
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5 text-success" />
                      Usually confirmed within hours
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BadgeCheck className="size-3.5 text-success" />
                      No credit card required
                    </span>
                  </div>
                </div>

                {/* Action Button — two rails */}
                <div className="flex flex-col items-stretch justify-center gap-2 md:items-end">
                  {trialActive ? (
                    <span className="text-sm text-success font-medium px-4 py-3">
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
                    <>
                      <Button
                        className="w-full bg-success text-white hover:bg-success/90 md:w-auto md:px-8"
                        size="lg"
                        disabled={busy !== null || !isRenewableNow}
                        title={
                          !isRenewableNow
                            ? `Renewal opens ${renewalOpensLabel} — 2 days before your period ends.`
                            : undefined
                        }
                        onClick={() => openCheckout(plan.code)}
                      >
                        <CreditCard className="mr-2 size-4" />
                        {busy
                          ? "Opening checkout…"
                          : hasPlan
                            ? isRenewableNow
                              ? "Renew plan"
                              : `Renews ${renews ?? "next period"}`
                            : "Choose payment"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* How it works strip — both rails, since the chooser may
                  land a customer on either. */}
              <div className="border-t border-success/30 border-success/30 bg-success/10 bg-success/10 px-6 py-4">
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-white">1</span>
                    <div>
                      <p className="font-medium text-foreground">Choose how to pay</p>
                      <p className="text-xs text-muted-foreground">Card worldwide, or D17 in Tunisia</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-white">2</span>
                    <div>
                      <p className="font-medium text-foreground">Pay</p>
                      <p className="text-xs text-muted-foreground">Card is instant; D17 by transfer via La Poste or the app</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-white">3</span>
                    <div>
                      <p className="font-medium text-foreground">Your plan activates</p>
                      <p className="text-xs text-muted-foreground">Cards immediately; D17 after staff confirmation, usually within hours</p>
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
                        className={b.subscription?.cancelAtPeriodEnd ? "" : "bg-success/20 bg-success/10 text-success hover:bg-success/30 dark:hover:bg-success/20"}
                      >
                        {b.subscription?.cancelAtPeriodEnd
                          ? "Cancels at period end"
                          : statusLabel(b.state)}
                      </Badge>
                    </CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-2xl font-semibold tabular-nums">
                      {formatPlanPrice(plan.promo?.priceCents ?? plan.priceCents, plan.priceTndMillimes)}
                      {plan.promo ? (
                        <span className="text-sm font-normal text-muted-foreground line-through">
                          {formatPlanPrice(plan.promo.originalPriceCents, plan.priceTndMillimes)}
                        </span>
                      ) : null}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{plan.interval}
                      </span>
                    </p>
                    {plan.promo ? (
                      <p className="text-xs font-medium text-warning text-warning">
                        {plan.promo.percentOff}% discount applied
                      </p>
                    ) : null}
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
                <QuotaExhaustedBanner
                  poolTokens={b.poolTokens}
                  poolUsedTokens={b.poolUsedTokens}
                  resetDate={b.subscription?.currentPeriodEnd ?? b.period.end}
                />
                <QuotaPoolMeter
                  poolTokens={b.poolTokens}
                  poolUsedTokens={b.poolUsedTokens}
                  entitled={plan.models ?? []}
                />

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
                    <RefreshCw className="size-4" />
                    Gateway status
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p className="text-muted-foreground">
                    Limits are pushed to the gateway within a few minutes of a
                    plan change. Usage is metered from the ledger, so the
                    numbers here match what the gateway enforces.
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
            onSelectPlan={(code) => openCheckout(code)}
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
              <Button
                key={p.code}
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void changePlan(p.code)}
                className={`grid h-auto justify-stretch gap-3 p-4 text-left ${
                  p.code === plan?.code
                    ? "border-success/50 ring-1 ring-success/30"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {p.code === plan?.code ? <Badge className="bg-success text-white">Current</Badge> : null}
                </div>
                <p className="flex flex-wrap items-baseline gap-2 text-2xl font-semibold tabular-nums">
                  {formatPlanPrice(p.promo?.priceCents ?? p.priceCents, p.priceTndMillimes)}
                  {p.promo ? (
                    <span className="text-sm font-normal text-muted-foreground line-through">
                      {formatPlanPrice(p.promo.originalPriceCents, p.priceTndMillimes)}
                    </span>
                  ) : null}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <ul className="grid gap-1 text-sm text-muted-foreground">
                  {/* 0039: one shared pool, so this states the TOTAL once
                      instead of listing per-alias slices the customer was
                      never actually held to. */}
                  <li>
                    {compact(
                      Object.values(p.tokenLimits ?? {}).reduce(
                        (sum, n) => sum + (Number(n) > 0 ? Number(n) : 0),
                        0,
                      ),
                    )}{" "}
                    tokens / period, shared
                  </li>
                  <li>{p.maxKeys} API keys</li>
                  <li>{p.rpmLimit} req/min</li>
                  <li>{compact(p.tpmLimit ?? 0)} tok/min</li>
                </ul>
              </Button>
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

      {/* The rail chooser: opened by every buy/renew/compare trigger
          above, one place where D17 vs card is decided. */}
      <PaymentMethodDialog plan={checkoutPlan} onDismiss={() => setCheckoutPlan(null)} />
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

  // The plan the table emphasises. It was `p.code === "pro"`, which starts
  // highlighting a row that does not exist the moment the catalog is
  // renamed and highlights nothing at all on a single-plan catalog. The
  // most expensive plan is the one a comparison table exists to sell.
  const featured = plans.reduce((a, b) => (b.priceCents > a.priceCents ? b : a)).code;

  const features = [
    { key: "price", label: "Monthly price", getValue: (p: typeof plans[0]) => {
      const price = formatPlanPrice(p.promo?.priceCents ?? p.priceCents, p.priceTndMillimes);
      return p.promo ? `${price} (was ${formatPlanPrice(p.promo.originalPriceCents, p.priceTndMillimes)})` : price;
    } },
    { key: "pool-tokens", label: "Shared token pool", getValue: (p: typeof plans[0]) => {
      // 0039: ONE POOL. Listing a row per alias advertised a split that no
      // longer binds — a customer on 25M+25M still had all 50M available on
      // whichever alias they chose.
      const total = Object.values(p.tokenLimits ?? {}).reduce(
        (sum, n) => sum + (Number(n) > 0 ? Number(n) : 0),
        0,
      );
      return total > 0 ? `${compact(total)} / period` : "—";
    }, hideIfAllEmpty: true },
    { key: "rpm", label: "Calls / minute (rate limit)", getValue: (p: typeof plans[0]) => (p.rpmLimit ?? 0).toLocaleString() },
    { key: "tpm", label: "Tokens / minute", getValue: (p: typeof plans[0]) => compact(p.tpmLimit ?? 0) },
    { key: "keys", label: "API keys", getValue: (p: typeof plans[0]) => p.maxKeys.toString() },
    { key: "concurrency", label: "Max concurrency", getValue: (p: typeof plans[0]) => p.maxConcurrentRequests?.toString() ?? "—" },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/50">
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-5 text-success" />
          Compare plans
        </CardTitle>
        <CardDescription>
          One shared token pool per plan — spend it on whichever model you like.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Feature</th>
                {plans.map((p) => (
                  <th
                    key={p.code}
                    className={cn(
                      "px-4 py-3 text-center",
                      p.code === featured && "bg-success/10 bg-success/10",
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold text-foreground">{p.name}</span>
                      {p.code === currentPlanCode && (
                        <Badge className="bg-success text-white text-xs">Current</Badge>
                      )}
                      {p.code === featured && p.code !== currentPlanCode && (
                        <Badge className="bg-success text-white text-xs">Popular</Badge>
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
                <tr key={feat.key} className={i % 2 === 0 ? "bg-white " : "bg-muted/40"}>
                  <td className="px-4 py-3 font-medium text-foreground">{feat.label}</td>
                  {plans.map((p) => (
                    <td
                      key={p.code}
                      className={cn(
                        "px-4 py-3 text-center tabular-nums text-muted-foreground",
                        p.code === featured && "bg-success/10 bg-success/10 font-medium text-foreground",
                      )}
                    >
                      {feat.getValue(p)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Token pricing row */}
              <tr className="border-t bg-white">
                <td className="px-4 py-3 font-medium text-foreground">Token pricing</td>
                {plans.map((p) => (
                  <td key={p.code} className="px-4 py-3">
                    <div className="grid gap-1 text-xs">
                      {(p.models ?? []).length > 0 ? (
                        (p.models ?? []).map((modelId) => {
                          const price = MODEL_PRICES[modelId];
                          if (!price) return null;
                          return (
                            <div key={modelId} className="flex items-center justify-center gap-1">
                              <span className="text-muted-foreground">{price.label}:</span>
                              <span className="tabular-nums text-muted-foreground">
                                {usdPerMtok(price.input)} / {usdPerMtok(price.output)}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        Object.entries(MODEL_PRICES).map(([id, price]) => (
                          <div key={id} className="flex items-center justify-center gap-1">
                            <span className="text-muted-foreground">{price.label}:</span>
                            <span className="tabular-nums text-muted-foreground">
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
              <tr className="border-t bg-muted/50">
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
                        className={p.code === featured ? "bg-success text-white hover:bg-success/90 w-full" : "w-full"}
                        variant={p.code === featured ? "default" : "outline"}
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
      <div className="border-t bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Token budgets reset each billing period; a model stops when its
          blended-token budget is spent. Token prices shown are Zaino official
          USD rates (input / output per million tokens). Your DT cost is
          calculated at the current D17 exchange rate.
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
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <Clock className="size-5 text-warning" />
        <div className="flex-1">
          <p className="text-sm">
            <span className="font-medium">{title}</span>{" "}
            <span className="text-muted-foreground">{description}</span>
          </p>
        </div>
        {checkoutHref && !awaitingVerification ? (
          <Link
            href={checkoutHref}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-primary hover:bg-primary/80"
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
export function PaymentHistory() {
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
