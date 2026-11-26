import type { Metadata } from "next";
import Link from "next/link";

import { AdminEmptyState, AdminHeader, AdminPage, AdminStat } from "@/components/admin/stat-card";
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
import { searchCustomers } from "@/lib/admin/customers";
import { dateTime } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

/**
 * /admin/customers — a PERSON, not an account.
 *
 * THE PAGE THAT WAS MISSING. Every other console screen starts at
 * `organizations`, because that is the billing entity. Nothing started at
 * `users`, so "jane@acme.com emailed us" had no route in the product: an
 * operator could see her ORG only if they already knew which one it was, and a
 * person in two orgs was two unrelated rows on two pages.
 *
 * The org column is deliberately inline rather than behind the drill-down —
 * the first thing an operator wants to know is "which account is this", and
 * making them click to find out costs the one thing they do not have when a
 * customer is on the phone.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const q = one("q") ?? "";
  const unverified = one("unverified") === "1";
  const noOrg = one("no_org") === "1";
  const page = Math.max(1, Number(one("page") ?? "1") || 1);
  const pageSize = 25;

  const result = await searchCustomers({
    q: q || undefined,
    onlyUnverified: unverified || undefined,
    onlyWithoutOrg: noOrg || undefined,
    page,
    pageSize,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const unverifiedOnPage = result.rows.filter((r) => !r.emailVerifiedAt).length;
  const lockedOnPage = result.rows.filter((r) => r.lockedOut).length;

  /** Preserve the active filters across pagination. */
  const withParams = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (unverified) params.set("unverified", "1");
    if (noOrg) params.set("no_org", "1");
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/admin/customers?${s}` : "/admin/customers";
  };

  return (
    <AdminPage>
      <AdminHeader
        title="Customers"
        description="People, not accounts. Search by email or name; every organization a person belongs to is listed inline."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat
          label="Matching"
          value={result.total}
          hint={q ? `Search: “${q}”` : "All people with a login"}
        />
        <AdminStat
          label="Unverified"
          value={unverifiedOnPage}
          hint="Cannot check out until they confirm — on this page"
          tone={unverifiedOnPage > 0 ? "warning" : "neutral"}
        />
        <AdminStat
          label="Locked out"
          value={lockedOnPage}
          hint="Throttled by failed sign-ins — on this page"
          tone={lockedOnPage > 0 ? "danger" : "neutral"}
        />
      </dl>

      {/* A GET form, so a search is a URL: shareable, bookmarkable, and
          back-button friendly. Same idiom as the org roster. */}
      <form className="mt-6 flex flex-wrap items-center gap-2" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Email or name"
          className="h-9 w-64"
          aria-label="Search customers"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            name="unverified"
            value="1"
            defaultChecked={unverified}
            className="size-3.5 accent-foreground"
          />
          Unverified only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            name="no_org"
            value="1"
            defaultChecked={noOrg}
            className="size-3.5 accent-foreground"
          />
          No organization
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
        {q || unverified || noOrg ? (
          <Link href="/admin/customers" className="text-xs text-muted-foreground underline">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {result.rows.length === 0 ? (
          <AdminEmptyState>
            {q || unverified || noOrg
              ? "No one matches those filters. There may still be customers — try clearing the search."
              : "No customers yet."}
          </AdminEmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Person</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="pr-4 text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((c) => (
                <TableRow key={c.userId}>
                  <TableCell className="pl-4">
                    <Link
                      href={`/admin/customers/${c.userId}`}
                      className="font-medium hover:underline"
                    >
                      {c.name ?? c.email}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{c.email}</span>
                    {c.isStaff || c.lockedOut ? (
                      <span className="mt-1 flex gap-1">
                        {c.isStaff ? (
                          <Badge variant="outline" className="text-[10px]">
                            staff
                          </Badge>
                        ) : null}
                        {c.lockedOut ? (
                          <Badge variant="destructive" className="text-[10px]">
                            locked out
                          </Badge>
                        ) : null}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {c.emailVerifiedAt ? (
                      <Badge variant="secondary">verified</Badge>
                    ) : (
                      <Badge variant="outline">unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.orgs.length === 0 ? (
                      <span className="text-muted-foreground">none</span>
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        {c.orgs.map((o) => (
                          <span key={o.orgId}>
                            <Link
                              href={`/admin/orgs/${o.orgId}`}
                              className="hover:underline"
                            >
                              {o.name}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {o.role} · {o.planCode ?? "no plan"}
                              {o.status !== "active" ? ` · ${o.status}` : ""}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {dateTime(c.createdAt)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Link
                      href={`/admin/customers/${c.userId}`}
                      className="text-sm underline"
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {result.total} people
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
