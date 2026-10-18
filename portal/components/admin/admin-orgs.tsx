"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, RefreshCw, ShieldCheck, Undo2, Wallet } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd } from "@/lib/dashboard/format";
import { toast } from "sonner";

/**
 * The row shape, taken from the service that produces it.
 *
 * `import type` is erased at compile time, so this client component does
 * NOT pull `lib/admin/orgs.ts` — and therefore `db` — into the browser
 * bundle. Declaring the fields here instead would let the two drift, and
 * a drift between what the roster renders and what the drill-down holds
 * is exactly the class of bug this codebase keeps paying for.
 */
import type { AdminOrgRow } from "@/lib/admin/orgs";

export type AdminOrgItem = AdminOrgRow;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "suspended") return "destructive";
  return "secondary";
}

function entVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (status === "synced") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

/**
 * AdminOrgs — the operations console.
 *
 * Three manual powers, each routed to the endpoint that wraps the service
 * function, then a full server refresh: suspension, reactivation and the
 * retry all change state the page cannot safely guess (the gateway's
 * answer, the new entitlement status), so the row is re-read rather than
 * patched locally — the same rule the D17 queue follows.
 *
 * `canManage` gates suspend/reactivate/credit to staff `admin`; the routes
 * enforce it regardless (hiding is courtesy, the route is the authority).
 * Retry stays open to support — it is idempotent and changes nothing a
 * customer did not ask for.
 */
export function AdminOrgs({
  orgs,
  canManage,
  showDetail = true,
}: {
  orgs: AdminOrgItem[];
  canManage: boolean;
  /**
   * The drill-down reuses this component for its ACTIONS section only, so
   * it renders a bare action row instead of a one-line table — the keys,
   * members and payments next to it are already on that page.
   */
  showDetail?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creditTarget, setCreditTarget] = React.useState<AdminOrgItem | null>(null);

  async function act(orgId: string, kind: "suspend" | "reactivate" | "sync") {
    setBusy(`${orgId}:${kind}`);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: { message?: string };
            alreadyApplied?: boolean;
            syncOk?: boolean | null;
            syncError?: string | null;
          }
        | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That action could not be completed.");
        return;
      }

      // `no subscription` is not a failure. A brand-new account has no
      // plan to push, and the sync has already cut anything stale — the
      // service says so in `syncError`. Reporting it as a gateway problem
      // sends an operator chasing an outage that does not exist.
      const noSubscription = data?.syncError === "no subscription";
      const syncFailed = data?.syncOk === false && !noSubscription;

      if (kind === "suspend") {
        toast.success(
          data?.alreadyApplied
            ? "Already suspended."
            : syncFailed
              ? "Suspended, but the gateway push failed — retry the sync."
              : noSubscription
                ? "Suspended. The account has no subscription, so nothing needed cutting."
                : "Suspended. The gateway has been cut.",
        );
      } else if (kind === "reactivate") {
        toast.success(
          syncFailed
            ? "Reactivated, but the gateway push failed — retry the sync."
            : data?.alreadyApplied
              ? "Already active."
              : noSubscription
                ? "Reactivated. The account has no subscription to restore limits for."
                : "Reactivated. Limits re-pushed.",
        );
      } else {
        toast.success(
          noSubscription
            ? "Nothing to sync — this account has no subscription."
            : syncFailed
              ? "Sync still failing — check the gateway."
              : "Entitlements re-pushed.",
        );
      }
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (orgs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No organizations yet.</p>
      </div>
    );
  }

  // The actions block on the drill-down: no table, just the powers.
  if (!showDetail) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {orgs.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void act(o.id, "sync")}
            >
              <RefreshCw />
              Retry sync
            </Button>
            {canManage && o.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void act(o.id, "suspend")}
              >
                <Ban />
                Suspend
              </Button>
            ) : null}
            {canManage && o.status === "suspended" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void act(o.id, "reactivate")}
              >
                <Undo2 />
                Reactivate
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setCreditTarget(o)}
              >
                <Wallet />
                Record credit
              </Button>
            ) : null}
            {!canManage ? (
              <p className="text-xs text-muted-foreground">
                Retry is available to support staff. Suspending an account and
                recording a credit require the admin role.
              </p>
            ) : null}
          </div>
        ))}

        <CreditDialog
          target={creditTarget}
          onClose={() => setCreditTarget(null)}
          onDone={() => {
            setCreditTarget(null);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Organization</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Gateway</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Upstream</TableHead>
            <TableHead className="text-right">Keys</TableHead>
            <TableHead className="pr-6 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((o) => {
            const overCap =
              o.hardCapCents !== null && o.periodCostUsd * 100 > o.hardCapCents;
            return (
              <TableRow key={o.id}>
                <TableCell className="pl-6 font-medium">
                  {o.name}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {o.slug}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                  {o.subStatus ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {o.subStatus}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {o.planCode ? (
                    <Badge variant="secondary">{o.planCode}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">no plan</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={entVariant(o.entitlementStatus)}>
                    {o.entitlementStatus ?? "none"}
                  </Badge>
                  {o.entitlementStatus === "failed" && o.entitlementError ? (
                    <p className="mt-1 max-w-44 truncate text-xs text-destructive">
                      {o.entitlementError}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${overCap ? "text-destructive" : ""}`}
                >
                  {usd(o.periodCostUsd)}
                  {overCap ? (
                    <span className="block text-xs">over cap</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {usd(o.periodCostUpstreamUsd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.keyCount}</TableCell>
                <TableCell className="pr-6 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/orgs/${o.id}`} />}
                    >
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(o.id, "sync")}
                    >
                      <RefreshCw />
                      Retry sync
                    </Button>
                    {canManage && o.status === "active" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void act(o.id, "suspend")}
                      >
                        <Ban />
                        Suspend
                      </Button>
                    ) : null}
                    {canManage && o.status === "suspended" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void act(o.id, "reactivate")}
                      >
                        <Undo2 />
                        Reactivate
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setCreditTarget(o)}
                      >
                        <Wallet />
                        Credit
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <CreditDialog
        target={creditTarget}
        onClose={() => setCreditTarget(null)}
        onDone={() => {
          setCreditTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function CreditDialog({
  target,
  onClose,
  onDone,
}: {
  target: AdminOrgItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState<"TND" | "USD">("TND");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (target) {
      setAmount("");
      setCurrency("TND");
      setReason("");
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    const major = Number.parseFloat(amount);
    if (!Number.isFinite(major) || major === 0) {
      toast.error("Enter a non-zero amount.");
      return;
    }
    const amountCents = Math.round(major * 100);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: target.id,
          amountCents,
          currency,
          reason,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? "The credit note could not be recorded.");
        return;
      }
      toast.success("Credit note recorded.");
      onDone();
    } catch {
      toast.error("The network request failed. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a credit note</DialogTitle>
          <DialogDescription>
            A record of a manual transfer. Negative refunds {target?.name ?? "the customer"};
            positive credits their next bill. This does not move money by itself.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Amount</span>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. -20.00"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "TND" | "USD")}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label="Currency"
              >
                <option value="TND">TND</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Why this money moved — visible to the next operator."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Recording…" : "Record credit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
