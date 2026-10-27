import type { Metadata } from "next";
import Link from "next/link";

import { AdminHeader, AdminPage, AdminStat } from "@/components/admin/stat-card";
import { AdminOrgs } from "@/components/admin/admin-orgs";
import { listAdminOrgsFiltered } from "@/lib/admin/orgs";
import { listPlansAdmin } from "@/lib/admin/plans";
import { currentStaffRole, staffAtLeast } from "@/lib/auth/authorize";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Organization Accounts" };
export const dynamic = "force-dynamic";

/**
 * /admin/orgs — the filterable account roster.
 *
 * FILTERS ARE SERVER-SIDE, IN THE URL. Every control is a GET form whose
 * inputs carry the current state, so the whole filtered view is a
 * shareable link and the browser Back button walks the filter history
 * rather than resetting it. No client state, no effect, no fetch — which
 * also means a filter cannot render a table the server did not produce.
 *
 * This replaces the console's original behaviour: the newest 200 orgs
 * with no way to search. That was correct on an empty database and
 * useless once there were accounts, because an operator who knows a
 * customer's name has no way to find them.
 *
 * `total` comes from the service counting over the SAME WHERE as the
 * page, so "142 accounts match" is a fact about the database rather than
 * an artifact of which 25 rows arrived.
 *
 * THE TABLE IS `<AdminOrgs>`, NOT A LOCAL COPY. This page used to
 * re-implement that component's table, which silently dropped every row
 * action it owns: retry sync, suspend, reactivate and record-credit were
 * only reachable by opening an account one at a time. Rendering the
 * shared component restores them and keeps the roster and the drill-down
 * from drifting apart again.
 *
 * `canManage` is decided from the staff role, which the layout has
 * already resolved. Hiding the buttons is courtesy — `requireStaff('admin')`
 * in each route is the actual authority.
 */
export default async function AdminOrgsPage({
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
  const status = one("status");
  const plan = one("plan");
  const failed = one("failed") === "true";
  const overCap = one("over_cap") === "true";
  const page = Math.max(1, Number(one("page") ?? "1") || 1);

  const [result, plans, role] = await Promise.all([
    listAdminOrgsFiltered({
      q: q || undefined,
      status: status === "active" || status === "suspended" ? status : undefined,
      planCode: plan || undefined,
      entitlementFailed: failed || undefined,
      overCapOnly: overCap || undefined,
      page,
      pageSize: 25,
    }),
    listPlansAdmin(),
    currentStaffRole(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const canManage = role !== null && staffAtLeast(role, "admin");
  const suspended = result.rows.filter((r) => r.status === "suspended").length;
  const overCapped = result.rows.filter(isOverCap).length;
  const failing = result.rows.filter((r) => r.entitlementStatus === "failed").length;

  return (
    <AdminPage>
      <AdminHeader
        title="Accounts"
        description="Every customer organisation, what it is on, whether the gateway agrees, and what it has spent."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat
          label="Matching accounts"
          value={result.total}
          hint={`Page ${result.page} of ${totalPages}`}
        />
        <AdminStat
          label="Suspended"
          value={suspended}
          hint="on this page"
          tone={suspended > 0 ? "warning" : "neutral"}
        />
        <AdminStat
          label="Over cap"
          value={overCapped}
          hint="on this page"
          tone={overCapped > 0 ? "danger" : "neutral"}
        />
        <AdminStat
          label="Sync failing"
          value={failing}
          hint="on this page"
          tone={failing > 0 ? "warning" : "neutral"}
        />
      </dl>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <form
        method="get"
        action="/admin/orgs"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <label className="grid gap-1.5 text-xs font-medium">
          Search
          <Input name="q" defaultValue={q} placeholder="Name or slug" className="h-9 w-56" />
        </label>

        <label className="grid gap-1.5 text-xs font-medium">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium">
          Plan
          <select
            name="plan"
            defaultValue={plan ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Any</option>
            {plans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs font-medium">
          <input type="checkbox" name="failed" value="true" defaultChecked={failed} className="size-4" />
          Sync failing
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs font-medium">
          <input type="checkbox" name="over_cap" value="true" defaultChecked={overCap} className="size-4" />
          Over cap
        </label>

        <div className="flex gap-2 pb-0.5">
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/orgs" />}>
            Reset
          </Button>
        </div>
      </form>

      {/* ── Roster ──────────────────────────────────────────────────── */}
      <div className="mt-6">
        <AdminOrgs
          orgs={result.rows}
          canManage={canManage}
          plans={plans}
          emptyMessage="No accounts match these filters."
        />
      </div>

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {result.page} of {totalPages} · {result.total} accounts
          </p>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={pageHref(sp, result.page - 1)} />}
              >
                Previous
              </Button>
            ) : null}
            {result.page < totalPages ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={pageHref(sp, result.page + 1)} />}
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

function isOverCap(o: { hardCapCents: number | null; periodCostUsd: number }): boolean {
  return o.hardCapCents !== null && o.periodCostUsd * 100 > o.hardCapCents;
}

/**
 * Rebuild the query string with a different page, dropping `page` when
 * returning to the first so the "Next" link does not produce a URL that
 * differs from the reset one for no reason.
 */
function pageHref(
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
  return qs ? `/admin/orgs?${qs}` : "/admin/orgs";
}
