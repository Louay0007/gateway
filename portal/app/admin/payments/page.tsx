import type { Metadata } from "next";
import Link from "next/link";

import { AdminEmptyState, AdminHeader, AdminPage, AdminStat } from "@/components/admin/stat-card";
import { paymentTone } from "@/components/admin/badge-tones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listFailedEvents, listPayments } from "@/lib/admin/payments";
import { dateTime, usd } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const STATUSES = ["pending_payment", "proof_submitted", "paid", "rejected", "expired"] as const;

/**
 * /admin/payments — the cross-org ledger, and the failed-webhook backlog.
 *
 * ONE RAIL ONLY, AND THE PAGE SAYS SO. D17 (bank transfer, TND) writes a row
 * here that we own. Dodo (card, USD) is a hosted checkout: we store the
 * subscription and one `billing_events` row per webhook, but no amount and no
 * receipt — those live at Dodo. A page called "Payments" that silently omitted
 * card revenue would be worse than one that names where it is, so the footer
 * is part of the design rather than an apology.
 *
 * THE BACKLOG IS THE POINT. `billing_events` was written by every webhook and
 * read by NO screen, so an event that failed five times was invisible: the
 * subscription simply never activated, and the customer was told to try again.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const status = one("status");
  const q = one("q") ?? "";
  const stale = one("stale") === "1";
  const page = Math.max(1, Number(one("page") ?? "1") || 1);
  const pageSize = 25;

  const [result, failed] = await Promise.all([
    listPayments({
      status: status && (STATUSES as readonly string[]).includes(status) ? status : undefined,
      q: q || undefined,
      staleOnly: stale || undefined,
      page,
      pageSize,
    }),
    // A bounded read: this is a "look at the problem" list, not an export.
    listFailedEvents(5),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const paidOnPage = result.rows.filter((r) => r.status === "paid");
  const paidUsd = paidOnPage.reduce((a, r) => a + r.usdAmountCents / 100, 0);

  const withParams = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (stale) params.set("stale", "1");
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/admin/payments?${s}` : "/admin/payments";
  };

  return (
    <AdminPage>
      <AdminHeader
        title="Payments"
        description="Every transfer this platform has been asked to honour, across all accounts — with the webhooks that never completed beside it."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat
          label="Matching"
          value={result.total}
          hint={q || status || stale ? "Filtered" : "All D17 payments, all time"}
        />
        <AdminStat
          label="Paid here"
          value={usd(paidUsd)}
          hint="Verified rows on this page only"
          tone={paidUsd > 0 ? "positive" : "neutral"}
        />
        <AdminStat
          label="Failed webhooks"
          value={failed.length}
          hint={failed.length > 0 ? "Unprocessed events — a subscription may not have activated" : "Nothing stuck"}
          tone={failed.length > 0 ? "danger" : "neutral"}
        />
      </dl>

      {failed.length > 0 ? (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="text-sm font-medium">Webhooks that never completed</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These arrived from a payment provider and were never processed. The customer's
            subscription may not have activated, so they will have been told to try again.
          </p>
          <ul className="mt-3 grid gap-2">
            {failed.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <Badge variant="outline">{e.provider}</Badge>
                <span className="font-mono">{e.id}</span>
                <span className="text-muted-foreground">
                  {e.attempts} attempt{e.attempts === 1 ? "" : "s"} · {e.ageHours}h old
                  {e.lastError ? ` · ${e.lastError}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form className="mt-6 flex flex-wrap items-center gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Phone, auth #, plan or account"
          className="h-9 w-72"
          aria-label="Search payments"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          aria-label="Status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            name="stale"
            value="1"
            defaultChecked={stale}
            className="size-3.5 accent-foreground"
          />
          Expired claims only
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
        {q || status || stale ? (
          <Link href="/admin/payments" className="text-xs text-muted-foreground underline">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {result.rows.length === 0 ? (
          <AdminEmptyState>
            {q || status || stale
              ? "No payments match those filters."
              : "No D17 payments have been recorded yet."}
          </AdminEmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Authorization</TableHead>
                <TableHead>Sender</TableHead>
                <TableHead className="pr-4 text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4">
                    <Link href={`/admin/orgs/${p.organizationId}`} className="font-medium hover:underline">
                      {p.organizationName}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {p.planCode ?? "no plan"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {(p.amountMillimes / 1000).toFixed(3)} {p.currency}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {usd(p.usdAmountCents / 100)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={paymentTone(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                    {p.expiredForSeconds ? (
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        expired {Math.round(p.expiredForSeconds / 86400)}d ago
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.authorizationNumber ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.senderPhone ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                    <Link href={`/admin/payments/${p.id}`} className="underline">
                      {dateTime(p.submittedAt ?? p.verifiedAt ?? "")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Card payments are not on this page.</strong>{" "}
        Dodo is a hosted checkout — we store the subscription and the webhook event, never the
        amount or the receipt, so those live in the Dodo dashboard. This ledger shows the D17
        (bank transfer) rail only, and the two are deliberately not summed.
      </p>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {result.total} payments
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className="text-sm underline" href={withParams({ page: String(page - 1) })}>
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className="text-sm underline" href={withParams({ page: String(page + 1) })}>
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </AdminPage>
  );
}
