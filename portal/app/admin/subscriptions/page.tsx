import type { Metadata } from "next";
import Link from "next/link";

import { AdminEmptyState, AdminHeader, AdminPage, AdminStat } from "@/components/admin/stat-card";
import { subStatusTone } from "@/components/admin/badge-tones";
import { SubscriptionLifecycle } from "@/components/admin/subscription-lifecycle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentStaffRole, staffAtLeast } from "@/lib/auth/authorize";
import { listSubscriptionLifecycle } from "@/lib/admin/lifecycle";
import { dateTime, rangeLabel } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

/**
 * /admin/subscriptions — the lifecycle queue.
 *
 * ANSWERS TWO QUESTIONS NOTHING COULD ASK BEFORE: "what expires next" (so
 * renewals can be watched rather than discovered) and "what is already broken"
 * (so a `past_due` account is a row, not a customer complaint).
 *
 * Every row carries the lifecycle controls, because the reason an operator
 * opens this page is to ACT on one of them. Sending them to the account page
 * first would make the most common task two navigations.
 */
export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const status = one("status") ?? "";
  const pageSize = 50;

  const [rows, role] = await Promise.all([
    listSubscriptionLifecycle({
      status: status || undefined,
      pageSize,
    }),
    currentStaffRole(),
  ]);

  const canAdmin = role !== null && staffAtLeast(role, "admin");
  const canOwner = role !== null && staffAtLeast(role, "owner");

  const pastDue = rows.rows.filter((r) => r.status === "past_due").length;
  const scheduled = rows.rows.filter((r) => r.cancelAtPeriodEnd).length;
  const removed = rows.rows.filter((r) => r.removedAt).length;

  const STATUSES = ["active", "trialing", "past_due", "unpaid", "paused", "canceled", "incomplete"];

  return (
    <AdminPage>
      <AdminHeader
        title="Subscriptions"
        description="The lifecycle queue: what expires next, what has lapsed, and what an operator has already ended."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat label="Shown" value={rows.total} hint="Matching the filter" />
        <AdminStat
          label="Past due"
          value={pastDue}
          hint="Cut at the gateway — the customer cannot use what they owe for"
          tone={pastDue > 0 ? "warning" : "neutral"}
        />
        <AdminStat
          label="Scheduled to end"
          value={scheduled}
          hint="Cancelled but still inside a paid period"
          tone={scheduled > 0 ? "warning" : "neutral"}
        />
      </dl>

      <form className="mt-6 flex flex-wrap items-center gap-2" method="get">
        <select
          name="status"
          defaultValue={status}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          aria-label="Status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
        {status ? (
          <Link href="/admin/subscriptions" className="text-xs text-muted-foreground underline">
            Clear
          </Link>
        ) : null}
        {removed > 0 ? (
          <span className="text-xs text-muted-foreground">
            {removed} removed by an operator on this page
          </span>
        ) : null}
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {rows.rows.length === 0 ? (
          <AdminEmptyState>
            {status ? "No subscriptions with that status." : "No subscriptions yet."}
          </AdminEmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Account</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="pr-4">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    <Link href={`/admin/orgs/${s.organizationId}`} className="font-medium hover:underline">
                      {s.organizationName}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{s.organizationSlug}</span>
                    {s.removedAt ? (
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        removed {dateTime(s.removedAt)}
                        {s.removalReason ? ` · ${s.removalReason}` : ""}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{s.planCode ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Badge variant={subStatusTone(s.status)}>{s.status}</Badge>
                    {s.cancelAtPeriodEnd ? (
                      <span className="mt-1 block text-[10px] text-muted-foreground">cancels at end</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rangeLabel(s.currentPeriodStart, s.currentPeriodEnd) ?? "—"}
                    {s.currentPeriodEnd ? (
                      <span className="mt-0.5 block">{dateTime(s.currentPeriodEnd)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="pr-4">
                    <SubscriptionLifecycle
                      orgId={s.organizationId}
                      status={s.status}
                      cancelAtPeriodEnd={s.cancelAtPeriodEnd}
                      canAdmin={canAdmin}
                      canOwner={canOwner}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!canAdmin ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Viewing only. Cancelling, resuming and extending require the admin role; removing a
          subscription requires the owner role.
        </p>
      ) : null}
    </AdminPage>
  );
}
