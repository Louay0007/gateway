"use client";

/**
 * PaymentMethodDialog — the rail chooser between a plan click and a
 * provider checkout.
 *
 * Two rails live behind one price card, and a customer should never be
 * dropped onto one without being shown the other: a Tunisian on a VPN
 * sees a card checkout, an international customer sees a D17
 * instruction page — both read as bugs. So EVERY "buy/renew this plan"
 * click in BillingView opens this dialog first, showing both rails with
 * their logos and the plan's own two prices (they never derive from one
 * another), and the seat count for per-seat plans.
 *
 * Confirm lands on POST /api/checkout with the chosen `method`, and the
 * response URL REPLACES this dialog: for Dodo it is Dodo's hosted
 * checkout, for D17 our own transfer-instruction page. Both are new
 * documents, so a full-window navigation (not the client router) is
 * what carries the customer out; returning happens through the
 * `return` path the body carries.
 */

import * as React from "react";
import Image from "next/image";
import { Check, CreditCard, Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanSummary } from "@/lib/billing/state";
import { formatPlanPrice, tndPrice } from "@/lib/dashboard/format";
import { toast } from "sonner";

type Method = "d17" | "dodo";

/** Every dialog open starts here until the customer changes it. */
const DEFAULT_SEATS = 1;

const METHODS: {
  id: Method;
  title: string;
  subtitle: string;
  logo: string;
  alt: string;
}[] = [
  {
    id: "d17",
    title: "D17 transfer",
    subtitle: "La Poste Tunisienne · pay in TND",
    logo: "/images/d17-logo.webp",
    alt: "D17 logo",
  },
  {
    id: "dodo",
    title: "Card",
    subtitle: "Worldwide cards · pay in USD (via Dodo)",
    logo: "/images/dodo-logo.svg",
    alt: "Dodo Payments logo",
  },
];

interface PaymentMethodDialogProps {
  /** The plan under checkout; null when the dialog is closed. */
  plan: PlanSummary | null;
  onDismiss: () => void;
}

export function PaymentMethodDialog({ plan, onDismiss }: PaymentMethodDialogProps) {
  const [method, setMethod] = React.useState<Method>("d17");
  const [seats, setSeats] = React.useState(DEFAULT_SEATS);
  const [busy, setBusy] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<string | null>(null);

  // Pro (and any per-seat plan) always OPENS at exactly 1 seat. The reset
  // is synchronous during render, not in an effect: an effect fires after
  // paint, so a reopened dialog would flash the previous seat count
  // before snapping back. One visible footgun this kills: pick 3 seats,
  // close, reopen a minute later — you must see $30 / 90 DT for 1, never
  // the stale 3. (A failed checkout keeps the dialog open and does NOT
  // reset, since the same open means the same decision in progress.)
  const planCode = plan?.code ?? null;
  if (planCode !== resetFor) {
    setResetFor(planCode);
    setSeats(DEFAULT_SEATS);
    setMethod("d17");
  }

  const maxSeats = plan?.maxSeats ?? 1;
  const listCents = plan?.promo?.priceCents ?? plan?.priceCents ?? 0;
  const originalCents = plan?.promo ? plan.promo.originalPriceCents : plan?.priceCents ?? 0;

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planCode: plan.code,
          method,
          seats,
          // See BillingView.beginCheckout: the returning customer must
          // land in the shell that asked.
          returnPath: window.location.pathname + window.location.search,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { checkoutUrl?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !data?.checkoutUrl) {
        throw new Error(data?.error?.message ?? "Checkout could not be started.");
      }
      // The provider checkout is a different document (Dodo's hosted
      // page or our D17 instruction page) — hand the whole window over.
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setBusy(false);
      // The dialog STAYS OPEN on failure: the rail choice was made, the
      // failure is usually transient (rate limit, need to verify email),
      // and making the customer re-decide is exactly what this component
      // exists to avoid.
      toast.error(e instanceof Error ? e.message : "Checkout could not be started.");
    }
  }

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose how to pay</DialogTitle>
          <DialogDescription>
            {plan
              ? `${plan.name} — charged monthly. Cards or a D17 transfer; the price is fixed for each.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {plan ? (
          <div className="grid gap-4">
            {/* The one price row, both rails, from the catalog's own two
                numbers — never a conversion between them. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold">
                {formatPlanPrice(listCents, plan.priceTndMillimes, maxSeats > 1 ? seats : 1)}
              </span>
              <span className="text-muted-foreground">/month</span>
              {plan.promo ? (
                <span className="text-muted-foreground line-through">
                  was {formatPlanPrice(originalCents, plan.priceTndMillimes)}
                </span>
              ) : null}
            </div>

            {maxSeats > 1 ? (
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Seats ({formatPlanPrice(listCents, plan.priceTndMillimes, 1)} each)
                <select
                  className="rounded-md border bg-transparent px-2 py-2 text-sm"
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                >
                  {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div
              role="radiogroup"
              aria-label="Payment method"
              className="grid gap-2 sm:grid-cols-2"
            >
              {METHODS.map((m) => {
                const selected = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMethod(m.id)}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${ selected ? "border-success bg-success/5 bg-success/10" : "border-border hover:border-success/50 hover:bg-muted/50" }`}
                  >
                    {/* Room for the mark at its brand size; Dodo's is a
                        round badge, D17's a wide wordmark. */}
                    <Image
                      src={m.logo}
                      alt={m.alt}
                      width={m.id === "dodo" ? 28 : 48}
                      height={28}
                      className={`shrink-0 ${m.id === "dodo" ? "rounded-full" : "object-contain"}`}
                    />
                    <span className="grid gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {m.title}
                        {selected ? (
                          <Check className="size-4 text-success" />
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{m.subtitle}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* What each rail asks, spelled out in its own currency so
                nobody confirms against a number they did not expect.
                D17 charges the plan's exact dinar ask (per-row, 0037);
                Dodo charges the USD list price once per seat. */}
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              {method === "dodo" ? (
                <span className="flex items-center gap-1.5">
                  <CreditCard className="size-3.5 shrink-0" />
                  You will continue to Dodo&#39;s secure checkout and pay{" "}
                  <strong className="text-foreground">
                    {formatPlanPrice(listCents, null, maxSeats > 1 ? seats : 1)}
                  </strong>
                  .
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Landmark className="size-3.5 shrink-0" />
                  You will transfer{" "}
                  <strong className="text-foreground">
                    {plan.priceTndMillimes
                      ? tndPrice(plan.priceTndMillimes)
                      : "the exact amount shown"}
                  </strong>{" "}
                  inside the D17 app.
                </span>
              )}
            </div>

            {method === "d17" && !plan.priceTndMillimes ? (
              <p className="text-xs text-muted-foreground">
                This plan currently lists a card price only; the D17 window will
                show the exact dinars to transfer.
              </p>
            ) : null}
            {method === "d17" && maxSeats > 1 ? (
              <p className="text-xs text-muted-foreground">
                D17 charges the listed plan price. For a per-seat Pro buy, pay by
                card — the seat count is taken there.
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" disabled={busy} />}>
                Cancel
              </DialogClose>
              <Button
                className="bg-success text-white hover:bg-success/90"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy
                  ? "Opening checkout…"
                  : method === "dodo"
                    ? "Continue to card payment"
                    : "Continue to D17"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No plan selected.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
