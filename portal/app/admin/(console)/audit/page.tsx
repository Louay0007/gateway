import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminEmptyState,
  AdminHeader,
  AdminPage,
  AdminStat,
} from "@/components/admin/stat-card";
import { listAudit } from "@/lib/admin/orgs";
import { dateTime } from "@/lib/dashboard/format";

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

export const metadata: Metadata = { title: "Audit Trail" };
export const dynamic = "force-dynamic";

/**
 * /admin/audit — the trail.
 *
 * `audit_log` has been written by every money-moving action since 0001
 * and read by nothing. The questions it answers — "who suspended this
 * account on the 12th?", "what did this customer do before they
 * cancelled?", "did anyone retry that sync?" — were unanswerable from the
 * product, which is an uncomfortable thing to discover during a dispute.
 *
 * `action` filters by PREFIX, so `organization.` returns both
 * `organization.suspended` and `organization.reactivated` without anyone
 * having to enumerate the event names.
 *
 * `before`/`after` are rendered raw and collapsed. They are per-action
 * JSON by design, and a normalised table would have to flatten most of
 * them into something that no longer describes what happened.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const action = one("action") ?? "";
  const actor = one("actor") ?? "";
  const organization = one("organization") ?? "";
  const page = Math.max(1, Number(one("page") ?? "1") || 1);

  const result = await listAudit({
    action: action || undefined,
    actorType: actor || undefined,
    organizationId: organization || undefined,
    page,
    pageSize: 50,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <AdminPage>
      <AdminHeader
        title="Audit"
        description="Every recorded event, newest first. This is the record of who changed what — it is append-only and nothing here can be edited."
      />

      <form method="get" action="/admin/audit" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="grid gap-1.5 text-xs font-medium">
          Action prefix
          <Input name="action" defaultValue={action} placeholder="e.g. organization. or d17." className="h-9 w-56" />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Actor
          <select
            name="actor"
            defaultValue={actor}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Any</option>
            <option value="user">staff / user</option>
            <option value="system">system</option>
            <option value="provider">provider</option>
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm">Apply</Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/audit" />}>
            Reset
          </Button>
        </div>
      </form>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat label="Matching events" value={result.total} hint={`Page ${result.page} of ${totalPages}`} />
        <AdminStat
          label="Staff actions"
          value={result.rows.filter((r) => r.actorType === "user").length}
          hint="on this page"
        />
        <AdminStat
          label="System actions"
          value={result.rows.filter((r) => r.actorType === "system").length}
          hint="on this page"
        />
      </dl>

      <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
        {result.rows.length === 0 ? (
          <AdminEmptyState>No events match these filters.</AdminEmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="pr-4">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 whitespace-nowrap text-xs text-muted-foreground">
                    {dateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell>
                    <Badge variant={r.actorType === "user" ? "default" : "secondary"}>
                      {r.actorType}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs">
                    {r.organizationId ? (
                      <a href={`/admin/orgs/${r.organizationId}`} className="hover:underline">
                        {r.organizationName ?? r.organizationId.slice(0, 8)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">platform</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.targetType ? `${r.targetType}:${(r.targetId ?? "").slice(0, 12)}` : "—"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <details className="min-w-40 max-w-md">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        {r.before || r.after ? "view" : "—"}
                      </summary>
                      <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-md bg-muted p-2 text-xs leading-relaxed">
{JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                      </pre>
                    </details>
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
            Page {result.page} of {totalPages} · {result.total} events
          </p>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    href={hrefWith(sp, result.page - 1)}
                  />
                }
              >
                Previous
              </Button>
            ) : null}
            {result.page < totalPages ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    href={hrefWith(sp, result.page + 1)}
                  />
                }
              >
                Next
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </AdminPage>
  );
}

function hrefWith(
  sp: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value && k !== "page") params.set(k, value);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/audit?${qs}` : "/admin/audit";
}