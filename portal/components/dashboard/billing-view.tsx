"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  BadgeCheck,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
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
import { ErrorState, PanelSkeleton, PaywallState, RefreshingBar } from "@/components/dashboard/states";
import { SpendMeter } from "@/components/dashboard/spend-meter";
import { StatCard } from "@/components/dashboard/stat-card";
import { apiSend, useApi } from "@/lib/api/use-api";
import type {
  PlanListResponse,
  SubscriptionBundle,
  PaymentHistoryItem,
} from "@/lib/api/types";
import { centsUsd, compact, usd } from "@/lib/dashboard/format";
import { toast } from "sonner";

/**
 * BillingView — plan, spend and the exits, live.
 *
 * Every number here used to come from `mock-data.ts`. It now comes from
 * `GET /api/subscription`, which builds its usage figures from the LEDGER
 * (`usage_records`) rather than the rollup cache — PLATFORM §8.2, and the
 * reason the number a customer is shown can be re-derived from evidence.
 *
 * The four actions all route to their endpoint now:
 *   subscribe    → POST /api/checkout
 *   change plan  → POST /api/subscription/change-plan   (limits live, price at renewal)
 *   cancel       → POST /api/subscription/cancel        (two modes, genuinely different)
 *   resume       → POST /api/subscription/resume       (undoes cancel-at-period-end)
 *
 * The two cancel modes are confirmed separately and with different copy,
 * because the word "cancel" hides the entire difference: one keeps access
 * until the paid date, the other cuts the budget now (next request → 429)
 * while leaving the keys valid so re-subscribing is instant.
 *
 * NOTHING here is optimistic. These actions move money and remove access,
 * so every one reconciles against the server before the screen claims it
 * worked.
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
  const renews = b?.subscription?.currentPeriodEnd
    ? new Date(b.subscription.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  // Mirrors server isRenewable(): live + same plan is renewable when the
  // period ends within 7 days or has lapsed. The button must not promise
  // what POST /api/checkout will 409.
  const isRenewableNow = (() => {
    if (!b?.subscription || !hasPlan) return true; // paywall: checkout always allowed
    if (!['active', 'past_due', 'paused'].includes(b.subscription.status)) return true;
    if (!b.subscription.currentPeriodEnd) return true;
    const end = new Date(b.subscription.currentPeriodEnd).getTime();
    return Date.now() >= end - 7 * 86400000;
  })();
  const renewalOpensLabel = b?.subscription?.currentPeriodEnd
    ? new Date(new Date(b.subscription.currentPeriodEnd).getTime() - 7 * 86400000).toLocaleDateString(
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
      // The local cut stands even when the provider call failed — a
      // customer who asked to stop must stop being able to spend. Billing
      // needs a human on this one, and the UI must say so rather than
      // quietly reporting success.
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
          cta={
            <div className="flex flex-wrap justify-center gap-2">
              {plans.map((p) => (
                <Button
                  key={p.code}
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void beginCheckout(p.code)}
                >
                  {p.name} — {centsUsd(p.priceCents)}/mo
                </Button>
              ))}
            </div>
          }
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

      {/* An entitlement that failed to push is a silent-money bug: the
          dashboard says one thing and the gateway enforces another. It is
          surfaced here rather than left for the ops email. */}
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

      {plan ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Spend this period"
              value={usd(b.usage.costCustomerUsd)}
              hint={`${plan.name} · ${centsUsd(plan.includedSpendCents)} included`}
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
                      {centsUsd(plan.priceCents)}
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
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Spend this period</span>
                    <span className="tabular-nums">
                      {usd(b.usage.costCustomerUsd)} of{" "}
                      {centsUsd(plan.includedSpendCents)}
                    </span>
                  </div>
                  <SpendMeter
                    spentUsd={b.usage.costCustomerUsd}
                    includedCents={plan.includedSpendCents}
                    hardCapCents={plan.hardCapCents}
                  />
                  {/*
                    Pricing truth (0007): customer cost = upstream ×
                    multiplier for EVERY row. The $20 included is a discount
                    pool in customer dollars — the first $20 of customer
                    cost each period is covered by the base price. Overage
                    bills at the same multiplier (overage_markup_bps ==
                    rate_multiplier_bps - 10000 by invariant), and the
                    gateway stops traffic when customer cost would exceed
                    the hard cap (enforced as hardCap/multiplier upstream).
                  */}
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
                    <Landmark className="size-4" />
                    Payment method
                  </CardTitle>
                  <CardDescription>
                    Payments are verified manually through La Poste (D17).
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Method</span>
                    <span className="font-medium">D17 — La Poste</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={hasPlan ? "secondary" : "outline"}>
                      {hasPlan ? "Active" : "Awaiting first payment"}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    disabled={busy !== null || !isRenewableNow}
                    title={
                      !isRenewableNow
                        ? `Renewal opens ${renewalOpensLabel} — 7 days before your period ends.`
                        : undefined
                    }
                    onClick={() => void beginCheckout(plan.code, "d17")}
                  >
                    <CreditCard />
                    {busy
                      ? "Opening checkout…"
                      : hasPlan
                        ? isRenewableNow
                          ? "Renew for next period"
                          : `Renews ${renews ?? "next period"} — renewal opens later`
                        : "Pay with D17"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {hasPlan && !isRenewableNow
                      ? `Your current period is paid until ${renews}. The renewal button unlocks 7 days before it ends — early renewal keeps your overlap days.`
                      : "Transfer the amount shown at checkout, then submit the authorization number. Activation is manual and usually confirmed within hours."}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CircleDollarSign className="size-4" />
                    Usage math
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <Row label="Upstream cost" value={usd(b.usage.costUpstreamUsd)} />
                  <Row label="Your cost" value={usd(b.usage.costCustomerUsd)} />
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
                  p.code === plan?.code ? "border-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {p.code === plan?.code ? <Badge>Current</Badge> : null}
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {centsUsd(p.priceCents)}
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
 * PaymentHistory — every payment this account has made.
 *
 * The Billing page carried a "Recent payments" card from the first UI
 * rewrite rendering two invented rows. Behind it there was nothing:
 * `payments_d17` was a staff-only verification queue with no customer read
 * route at all. That matters more than it looks — a customer who wired
 * money to a La Poste counter and was told "activation is manual" has no
 * way to learn whether the transfer was received, is being checked, was
 * refused, or silently expired. This is that answer.
 *
 * All five statuses are shown, including the unflattering ones. A queue
 * view that only lists verified payments is worse than none: it implies
 * "nothing is wrong" when the truth is "we cannot see it".
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

/** One dated sentence. The date is the reassurance; the status is the news. */
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