"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Crown, MoreHorizontal, RefreshCw, Undo2, Wallet } from "lucide-react";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

import { GrantPlanDialog } from "@/components/admin/grant-plan-dialog";
import { entitlementTone, orgStatusTone } from "@/components/admin/badge-tones";

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
import type { PlanAdminRow } from "@/lib/admin/plans";

export type AdminOrgItem = AdminOrgRow;

/**
 * AdminOrgs — the operations console.
 *
 * Four manual powers, each routed to the endpoint that wraps the service
 * function, then a full server refresh: suspension, reactivation, the
 * entitlement retry, and a manual plan grant. All of them change state the
 * page cannot safely guess (the gateway's answer, the new entitlement
 * status, the period the server computed), so the row is re-read rather
 * than patched locally — the same rule the D17 queue follows.
 *
 * `canManage` gates suspend/reactivate/credit to staff `admin`; the routes
 * enforce it regardless (hiding is courtesy, the route is the authority).
 * Retry stays open to support — it is idempotent and changes nothing a
 * customer did not ask for.
 *
 * ONE COMPONENT, TWO SHAPES. The roster renders the table; the drill-down
 * passes `showDetail={false}` and gets the bare action row. That reuse is
 * deliberate and was previously half-implemented: `/admin/orgs` hand-rolled
 * its own copy of this table, so every row action here (retry, suspend,
 * credit) was unreachable from the roster — an operator had to open each
 * account individually to act on it. The page now renders this component,
 * which is why the row actions are a menu: five buttons per row did not
 * fit, and the table is shared, so the fix has to be in one place.
 */
export function AdminOrgs({
  orgs,
  canManage,
  plans = [],
  showDetail = true,
  emptyMessage = "No organizations yet.",
}: {
  orgs: AdminOrgItem[];
  canManage: boolean;
  /**
   * Catalog plans for the grant dialog. Passed in rather than fetched so
   * the picker is correct on first paint — a client fetch would show an
   * empty select for a beat on every page that renders actions.
   */
  plans?: PlanAdminRow[];
  /**
   * The drill-down reuses this component for its ACTIONS section only, so
   * it renders a bare action row instead of a one-line table — the keys,
   * members and payments next to it are already on that page.
   */
  showDetail?: boolean;
  /**
   * "No organizations yet" is wrong on a filtered roster: there may be
   * hundreds of accounts and none matching the filter, and telling an
   * operator the database is empty when they mistyped a search sends them
   * to the wrong conclusion.
   */
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creditTarget, setCreditTarget] = React.useState<AdminOrgItem | null>(null);
  const [grantTarget, setGrantTarget] = React.useState<AdminOrgItem | null>(null);
  const canGrant = canManage && plans.length > 0;

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
      <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
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
            {canGrant ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setGrantTarget(o)}
              >
                <Crown />
                Grant plan
              </Button>
            ) : null}
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
                Retry is available to support staff. Suspending an account,
                granting a plan and recording a credit require the admin role.
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
        <GrantPlanDialog
          org={grantTarget}
          plans={plans}
          onClose={() => setGrantTarget(null)}
          onDone={() => {
            setGrantTarget(null);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Organization</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Gateway</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Upstream</TableHead>
            <TableHead className="text-right">Keys</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((o) => {
            const overCap =
              o.hardCapCents !== null && o.periodCostUsd * 100 > o.hardCapCents;
            return (
              <TableRow key={o.id}>
                <TableCell className="pl-4 font-medium">
                  <Link href={`/admin/orgs/${o.id}`} className="hover:underline">
                    {o.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {o.slug}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={orgStatusTone(o.status)}>{o.status}</Badge>
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
                  <Badge variant={entitlementTone(o.entitlementStatus)}>
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
                <TableCell className="pr-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/orgs/${o.id}`} />}
                    >
                      Open
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${o.name}`}
                            disabled={busy !== null}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          disabled={busy !== null}
                          onClick={() => void act(o.id, "sync")}
                        >
                          <RefreshCw />
                          Retry sync
                        </DropdownMenuItem>
                        {canGrant ? (
                          <DropdownMenuItem onClick={() => setGrantTarget(o)}>
                            <Crown />
                            Grant plan
                          </DropdownMenuItem>
                        ) : null}
                        {canManage ? (
                          <DropdownMenuItem onClick={() => setCreditTarget(o)}>
                            <Wallet />
                            Record credit
                          </DropdownMenuItem>
                        ) : null}
                        {canManage ? <DropdownMenuSeparator /> : null}
                        {canManage && o.status === "active" ? (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={busy !== null}
                            onClick={() => void act(o.id, "suspend")}
                          >
                            <Ban />
                            Suspend
                          </DropdownMenuItem>
                        ) : null}
                        {canManage && o.status === "suspended" ? (
                          <DropdownMenuItem
                            disabled={busy !== null}
                            onClick={() => void act(o.id, "reactivate")}
                          >
                            <Undo2 />
                            Reactivate
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
      <GrantPlanDialog
        org={grantTarget}
        plans={plans}
        onClose={() => setGrantTarget(null)}
        onDone={() => {
          setGrantTarget(null);
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
