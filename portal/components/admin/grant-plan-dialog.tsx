"use client";

import * as React from "react";
import { CalendarClock, Crown } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortDate, usd } from "@/lib/dashboard/format";
import { periodFor, type PlanInterval } from "@/lib/admin/grant-schema";

// `import type` is erased at compile time, so this client component does
// not pull the plan service (and therefore `db`) into the browser bundle.
import type { PlanAdminRow } from "@/lib/admin/plans";
import type { AdminOrgItem } from "@/components/admin/admin-orgs";

/**
 * GrantPlanDialog — put this account on a plan by hand.
 *
 * WHAT THIS IS FOR. Everything else in the console assumes billing works:
 * D17 approval needs a submitted transfer, `changePlan` needs a live
 * subscription. Neither covers "make this account Pro, now" — a comped
 * partner, a customer whose transfer cleared but whose row got stuck in
 * `incomplete`, or an operator making good on a support promise.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   No reason field. That was the explicit product decision: the audit
 *   row IS the record, and a mandatory free-text box on a two-second
 *   action gets typed as "test" anyway. The before/after plan and period
 *   in `audit_log` carry the facts.
 *
 *   No money. A grant records service, not payment. If money actually
 *   moved, that is a credit note — and the copy below says so, because an
 *   operator who conflates the two produces an account that has been
 *   given a plan and no income to show for it.
 *
 * The period is PREVIEWED here and RECOMPUTED on the server. The preview
 * is the same pure `periodFor` function the service calls, so the date
 * shown is the date written — not an estimate. The server still ignores
 * any period the client might send.
 */
export function GrantPlanDialog({
  org,
  plans,
  onClose,
  onDone,
}: {
  org: AdminOrgItem | null;
  plans: PlanAdminRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [planCode, setPlanCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (org) setPlanCode(org.planCode ?? "");
  }, [org]);

  const selected = plans.find((p) => p.code === planCode) ?? null;

  // The same pure function the SERVICE calls, so the date previewed here
  // is the date written — including the month-end clamp. Computed once per
  // open so the preview cannot drift while the dialog sits open.
  const preview = React.useMemo(() => {
    if (!selected) return null;
    const interval: PlanInterval = selected.interval === "year" ? "year" : "month";
    return periodFor(interval);
  }, [selected, org?.id]);

  async function submit() {
    if (!org || !selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/grant-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: selected.code }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: { message?: string };
            periodEnd?: string;
            planName?: string;
            syncOk?: boolean;
            syncError?: string | null;
          }
        | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "The plan could not be granted.");
        return;
      }

      // The row is committed either way; only the gateway push can fail.
      // Saying "granted" while the push failed would leave the operator
      // believing the limits changed when they did not — and the same
      // toast pattern is used by suspend/reactivate for that reason.
      if (data?.syncOk === false) {
        toast.warning(
          `Granted ${data.planName}, but the gateway push failed${
            data.syncError ? ` (${data.syncError})` : ""
          }. Retry sync to finish.`,
        );
      } else {
        toast.success(`Granted ${data?.planName}. Limits pushed to the gateway.`);
      }
      onDone();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={org !== null} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-4 text-muted-foreground" />
            Grant a plan
          </DialogTitle>
          <DialogDescription>
            Puts {org?.name ?? "this account"} on a plan immediately and pushes
            its limits to the gateway. This records service, not payment — if
            money moved, record a credit note separately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <span className="text-muted-foreground">Currently</span>
            <p className="mt-0.5 font-medium">
              {org?.planCode ?? "no plan"}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {org?.subStatus ?? "no subscription"}
              </span>
            </p>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Plan</span>
            <select
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">Choose a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} — {usd(p.priceCents / 100)}/{p.interval}
                  {p.public ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          </label>

          {selected ? (
            <div className="grid gap-2 rounded-lg border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Period</span>
                <span className="flex items-center gap-1 text-right font-medium">
                  <CalendarClock className="size-3.5 shrink-0" />
                  {preview ? (
                    <span>
                      {shortDate(preview.start.toISOString())} →{" "}
                      {shortDate(preview.end.toISOString())}
                    </span>
                  ) : (
                    <span>one {selected.interval}</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Included spend</span>
                <span className="tabular-nums">
                  {usd(selected.includedSpendCents / 100)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Hard cap</span>
                <span className="tabular-nums">
                  {selected.hardCapCents === null
                    ? "none"
                    : usd(selected.hardCapCents / 100)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Models</span>
                <span className="max-w-52 truncate text-right">
                  {selected.models.length} allowed
                </span>
              </div>
              {!selected.public ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Badge variant="secondary">hidden</Badge>
                  Not shown on the public pricing page. Granting it still works.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            A granted period does not auto-renew: at the period end the
            subscription lapses through the normal expiry job. Granting the
            same plan twice replaces the window rather than extending it.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => void submit()} disabled={busy || !selected}>
            {busy ? "Granting…" : "Grant plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
