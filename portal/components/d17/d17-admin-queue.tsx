"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";

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
import { dateTime } from "@/lib/dashboard/format";
import { toast } from "sonner";

export interface D17QueueItem {
  paymentId: string;
  subscriptionId: string;
  organizationName: string;
  planCode: string;
  amount: string;
  authorizationNumber: string;
  senderPhone: string | null;
  screenshotPath: string | null;
  status: string;
  submittedAt: string | null;
  expiresAt: string;
  flaggedReview: boolean;
  rejectReason: string | null;
  rejections: number;
}

/**
 * D17AdminQueue — the verification desk.
 *
 * The page that used to do this was deleted with the old frontend, which
 * left `approveD17Payment`/`rejectD17Payment` with no reachable caller:
 * payments could be submitted but nobody could clear them. Approve and
 * reject now go over HTTP to the routes that wrap those exact service
 * functions, so the idempotency (`billing_events` on `d17:<id>:approved`)
 * and the one-resubmission budget still apply.
 *
 * After every action the page is refreshed from the database rather than
 * patched locally: the row's status, its rejection count, and whether the
 * approval was a duplicate are all server facts, and an operator acting on
 * a stale row is how a payment gets approved twice.
 *
 * `canReject` gates the reject button to staff `admin` — the same rule
 * `POST /api/admin/d17/[id]/reject` enforces. Hiding it is courtesy; the
 * route is the authority.
 */
export function D17AdminQueue({
  rows,
  canReject,
}: {
  rows: D17QueueItem[];
  canReject: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<D17QueueItem | null>(null);
  const [reason, setReason] = React.useState("");

  const actionable = rows.filter((r) => r.status === "proof_submitted");
  const rest = rows.filter((r) => r.status !== "proof_submitted");

  async function act(id: string, kind: "approve" | "reject", body?: unknown) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/d17/${id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string }; alreadyApplied?: boolean }
        | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That payment could not be updated.");
        return;
      }

      toast.success(
        kind === "approve"
          ? data?.alreadyApplied
            ? "Already approved — nothing was applied twice."
            : "Approved. The subscription is live and the gateway limits are pushed."
          : "Rejected. The customer has been told why.",
      );
      setRejectTarget(null);
      setReason("");
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing is waiting for verification.
        </p>
      </div>
    );
  }

  function table(items: D17QueueItem[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Organization</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Authorization</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-6 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.paymentId}>
              <TableCell className="pl-6 font-medium">
                <span className="flex items-center gap-2">
                  {row.organizationName}
                  {row.flaggedReview ? (
                    <Badge variant="destructive" className="gap-1">
                      <TriangleAlert />
                      Review
                    </Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{row.planCode}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.amount} DT</TableCell>
              <TableCell className="font-mono text-xs">{row.authorizationNumber || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{row.senderPhone ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.submittedAt ? dateTime(row.submittedAt) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                {row.status === "rejected" && row.rejectReason ? (
                  <p className="mt-1 max-w-40 truncate text-xs text-muted-foreground">
                    {row.rejectReason}
                  </p>
                ) : null}
                {row.rejections >= 1 && row.status === "rejected" ? (
                  <p className="text-xs text-destructive">Final — contact support.</p>
                ) : null}
              </TableCell>
              <TableCell className="pr-6 text-right">
                {row.status === "proof_submitted" ? (
                  <div className="flex justify-end gap-2">
                    {row.screenshotPath ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={
                          <a
                            href={`/api/admin/d17/${row.paymentId}/screenshot`}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                        aria-label={`Open the payment screenshot for ${row.organizationName}`}
                      >
                        <ExternalLink />
                        Proof
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy === row.paymentId}
                      onClick={() => act(row.paymentId, "approve")}
                    >
                      <ShieldCheck />
                      Approve
                    </Button>
                    {canReject ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === row.paymentId}
                        onClick={() => {
                          setRejectTarget(row);
                          setReason("");
                        }}
                      >
                        Reject
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <section className="grid gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Waiting for verification ({actionable.length})
        </h3>
        <div className="rounded-xl border border-border bg-card px-0 pb-0">
          {actionable.length > 0 ? (
            table(actionable)
          ) : (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No proofs are waiting.
            </p>
          )}
        </div>
      </section>

      {rest.length > 0 ? (
        <section className="grid gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Recently processed ({rest.length})
          </h3>
          <div className="rounded-xl border border-border bg-card px-0 pb-0 opacity-80">
            {table(rest)}
          </div>
        </section>
      ) : null}

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reject {rejectTarget?.organizationName}&apos;s payment?
            </DialogTitle>
            <DialogDescription>
              The customer is emailed the reason and may submit one more
              proof. A second rejection is final.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <label
              htmlFor="d17-reject-reason"
              className="text-sm font-medium text-foreground"
            >
              Reason (shown to the customer)
            </label>
            <textarea
              id="d17-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              aria-describedby="d17-reject-hint"
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p id="d17-reject-hint" className="text-xs text-muted-foreground">
              {reason.trim() ? `${reason.trim().length}/500` : "A reason is required."}
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              variant="destructive"
              disabled={!reason.trim() || busy === rejectTarget?.paymentId}
              onClick={() =>
                rejectTarget &&
                act(rejectTarget.paymentId, "reject", { reason: reason.trim() })
              }
            >
              Reject payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function statusVariant(
  status: string,
): "secondary" | "destructive" | "outline" | "default" {
  if (status === "proof_submitted") return "default";
  if (status === "paid") return "secondary";
  if (status === "rejected" || status === "expired") return "destructive";
  return "outline";
}

function statusLabel(status: string): string {
  switch (status) {
    case "proof_submitted":
      return "Awaiting review";
    case "paid":
      return "Verified";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "pending_payment":
      return "No proof yet";
    default:
      return status;
  }
}