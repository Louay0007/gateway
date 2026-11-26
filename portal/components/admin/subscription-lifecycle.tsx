"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";

/**
 * SubscriptionLifecycle — cancel, resume, remove, extend.
 *
 * WHY FOUR BUTTONS AND NOT ONE MENU. Three of them are reversible or partial
 * (cancel, resume, extend) and one is not (remove), so the destructive one is
 * separated visually and behind a typed reason. An operator scanning this row
 * at 2am should not be one misclick from ending a paying customer's service.
 *
 * EVERY CALL ENDS IN A GATEWAY SYNC on the server. The toast distinguishes
 * "the row changed" from "the gateway agreed", because those must never be
 * reported as the same outcome — the entire point of the sync is that the row
 * alone changes nothing a customer can feel.
 *
 * `canAdmin` / `canOwner` are UI courtesy only. `requireStaff('admin')` and
 * `requireStaff('owner')` are the authority on the routes; a disabled button is
 * noise reduction, not a control.
 */
export function SubscriptionLifecycle({
  orgId,
  status,
  cancelAtPeriodEnd,
  canAdmin,
  canOwner,
}: {
  orgId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  canAdmin: boolean;
  canOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [extendOpen, setExtendOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [days, setDays] = React.useState("7");

  /** Live statuses mean the cancel/resume/extend set applies. */
  const live = ["active", "trialing", "past_due"].includes(status);
  const scheduled = cancelAtPeriodEnd;

  async function post(path: string, body: Record<string, unknown>, okMessage: string) {
    setBusy(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string }; syncOk?: boolean; syncError?: string | null }
        | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That change could not be applied.");
        return false;
      }

      // `no subscription` is not a gateway outage — it is a brand-new account
      // with nothing to push, and the service says so in syncError.
      const noSubscription = data?.syncError === "no subscription";
      const syncFailed = data?.syncOk === false && !noSubscription;

      if (syncFailed) {
        toast.success(`${okMessage} But the gateway push failed — use Retry sync.`);
      } else {
        toast.success(okMessage);
      }
      router.refresh();
      return true;
    } catch {
      toast.error("The network request failed. Nothing was changed.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {live ? (
        scheduled ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!canAdmin || busy !== null}
            onClick={() => post(`/api/admin/orgs/${orgId}/subscription/resume`, {}, "Renewal restored.")}
          >
            {busy ? "Working…" : "Resume renewal"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!canAdmin || busy !== null}
            onClick={() =>
              post(
                `/api/admin/orgs/${orgId}/subscription/cancel`,
                {},
                "Set to cancel at the end of the paid period.",
              )
            }
          >
            {busy ? "Working…" : "Cancel at period end"}
          </Button>
        )
      ) : null}

      {live ? (
        <Button size="sm" variant="outline" disabled={!canAdmin || busy !== null} onClick={() => setExtendOpen(true)}>
          Extend period
        </Button>
      ) : null}

      {canOwner && status !== "canceled" ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={busy !== null}
          onClick={() => {
            setReason("");
            setRemoveOpen(true);
          }}
        >
          Remove…
        </Button>
      ) : null}

      {scheduled ? (
        <Badge variant="secondary" className="ml-1">
          cancels at period end
        </Badge>
      ) : null}

      {/* ── Remove: destructive, reasoned, and NOT a delete ────────────── */}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this subscription?</DialogTitle>
            <DialogDescription>
              The customer loses access now, before the period they paid for has finished. The
              subscription row and its payment history are kept — this is recorded as
              <code className="mx-1 rounded bg-muted px-1">canceled</code>, not deleted, so a
              later dispute can still be answered.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="removal-reason" className="text-sm font-medium">
              Reason
            </label>
            <Input
              id="removal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Chargeback, fraud, duplicate charge…"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Required. It is written to the subscription and the audit trail.
            </p>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || busy !== null}
              onClick={async () => {
                const ok = await post(
                  `/api/admin/orgs/${orgId}/subscription/remove`,
                  { reason: reason.trim() },
                  "Subscription removed. The gateway has been cut.",
                );
                if (ok) setRemoveOpen(false);
              }}
            >
              {busy ? "Removing…" : "Remove subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Extend: adds to the existing period, never replaces it ─────── */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend the current period</DialogTitle>
            <DialogDescription>
              Adds days to the period the customer already has, rather than starting a new one —
              the unused remainder is not swallowed. Use Grant plan to comp a fresh window.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <label htmlFor="extend-days" className="text-sm font-medium">
                Days
              </label>
              <Input
                id="extend-days"
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Between 1 and 90.</p>
            </div>
            <div className="grid gap-2">
              <label htmlFor="extend-reason" className="text-sm font-medium">
                Reason
              </label>
              <Input
                id="extend-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Two days of gateway downtime"
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={reason.trim().length < 3 || busy !== null}
              onClick={async () => {
                const ok = await post(
                  `/api/admin/orgs/${orgId}/subscription/extend`,
                  { days: Number(days), reason: reason.trim() },
                  `Period extended by ${days} day(s).`,
                );
                if (ok) setExtendOpen(false);
              }}
            >
              {busy ? "Extending…" : "Extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
