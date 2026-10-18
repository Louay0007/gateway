import type { Metadata } from "next";
import Link from "next/link";

import { AdminHeader, AdminStat } from "@/components/admin/stat-card";
import { dateTime, usd, usdPrecise } from "@/lib/dashboard/format";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { sql } from "drizzle-orm";
import { db } from "@/db";

export const metadata: Metadata = { title: "Credits" };
export const dynamic = "force-dynamic";

/**
 * /admin/credits — the refund ledger.
 *
 * This page is why `POST /api/admin/credits` was not dangerous in
 * isolation but was useless without it: staff could record a refund and
 * never read one back, so "what have we refunded this customer?" had to
 * be answered by hand in psql. A record nobody can read is not a record.
 *
 * APPEND-ONLY, matching the table. There is no edit and no delete here,
 * and that is intentional: a credit note records money that ACTUALLY
 * moved, so a correction is another credit note. That way the ledger
 * always explains itself and the running totals can never be quietly
 * rewritten.
 *
 * Amounts are SIGNED. A negative total means we have refunded more than
 * we credited over this filter, which is shown as such rather than
 * being an error.
 */
export default async function AdminCreditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const orgFilter = one("organization");
  const page = Math.max(1, Number(one("page") ?? "1") || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const rows = (await db.execute(sql`
    SELECT c.id::text, c.amount_cents, c.currency, c.reason,
           c.created_by, c.created_at,
           o.name AS organization_name, o.slug AS organization_slug,
           o.id::text AS organization_id
      FROM credit_notes c
      LEFT JOIN organizations o ON o.id = c.organization_id
     ${orgFilter ? sql`WHERE c.organization_id = ${orgFilter}::uuid` : sql``}
     ORDER BY c.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as {
    id: string;
    amount_cents: number;
    currency: string;
    reason: string;
    created_by: string;
    created_at: Date | string;
    organization_name: string | null;
    organization_slug: string | null;
    organization_id: string;
  }[];

  const summary = (await db.execute(sql`
    SELECT count(*)::int AS n,
           COALESCE(sum(amount_cents) FILTER (WHERE currency='USD'),0)::float8/100 AS net_usd,
           COALESCE(sum(amount_cents) FILTER (WHERE currency='TND'),0)::float8/100 AS net_tnd
      FROM credit_notes
     ${orgFilter ? sql`WHERE organization_id = ${orgFilter}::uuid` : sql``}
  `)) as unknown as { n: number; net_usd: number; net_tnd: number }[];

  const total = Number(summary[0]?.n ?? 0);
  const netUsd = Number(summary[0]?.net_usd ?? 0);
  const netTnd = Number(summary[0]?.net_tnd ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <AdminHeader
        title="Credit notes"
        description="Manual refunds and goodwill credits. D17 has no refund API, so every one of these is money a human transferred by hand."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat label="Notes" value={total} hint="Append-only · never edited or deleted" />
        <AdminStat
          label="Net USD"
          value={netUsd === 0 ? usdPrecise(0) : usd(netUsd)}
          hint={netUsd < 0 ? "Net refunded to customers" : "Net credited to customers"}
          tone={netUsd < 0 ? "warning" : "neutral"}
        />
        <AdminStat
          label="Net TND"
          value={netTnd === 0 ? usdPrecise(0) : usd(netTnd)}
          hint="Local currency, as actually transferred"
          tone={netTnd < 0 ? "warning" : "neutral"}
        />
      </dl>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No credit notes have been recorded.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="pr-6">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const cents = Number(c.amount_cents);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="pl-6 font-medium">
                      <a href={`/admin/orgs/${c.organization_id}`} className="hover:underline">
                        {c.organization_name ?? "unknown"}
                      </a>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {c.organization_slug}
                      </span>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        cents < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      <Badge variant="outline">
                        {cents < 0 ? "refund" : "credit"}
                      </Badge>
                      <span className="mt-1 block">
                        {cents < 0 ? "−" : "+"}
                        {usdPrecise(Math.abs(cents) / 100)} {c.currency}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md text-sm">{c.reason}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.created_by}</TableCell>
                    <TableCell className="pr-6 text-xs text-muted-foreground">
                      {dateTime(new Date(c.created_at).toISOString())}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {total} notes
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <a
                className="text-sm underline"
                href={`/admin/credits?${orgFilter ? `organization=${orgFilter}&` : ""}page=${page - 1}`}
              >
                Previous
              </a>
            ) : null}
            {page < totalPages ? (
              <a
                className="text-sm underline"
                href={`/admin/credits?${orgFilter ? `organization=${orgFilter}&` : ""}page=${page + 1}`}
              >
                Next
              </a>
            ) : null}
          </div>
        </nav>
      ) : null}
    </main>
  );
}