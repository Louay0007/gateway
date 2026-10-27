import type { Metadata } from "next";
import { Download } from "lucide-react";

import { AdminHeader, AdminPage, AdminStat } from "@/components/admin/stat-card";
import { D17AdminQueue, type D17QueueItem } from "@/components/d17/d17-admin-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentStaffRole, staffAtLeast, type StaffRole } from "@/lib/auth/authorize";
import { d17Reconciliation, listD17Queue } from "@/lib/billing/d17-admin";

const QUEUE_STATUSES = ["proof_submitted", "rejected", "paid", "expired"];

export const metadata: Metadata = { title: "D17 Payment Verification" };
export const dynamic = "force-dynamic";

/**
 * /admin/d17 — the manual-payment verification desk.
 *
 * Approving here is the ONLY thing that turns a D17 transfer into a live
 * subscription: there is no webhook to call (`d17.ts:verify()` throws by
 * design), so without this page and the two routes behind it, every
 * submitted payment sat in `proof_submitted` forever.
 *
 * The staff gate now lives in `app/admin/layout.tsx`, which resolves the
 * role once for the whole console and renders the "staff access required"
 * screen. This page still re-checks, because it needs the ROLE to decide
 * whether to offer the reject button — the layout knows only whether
 * staff access exists at all.
 *
 * Staff are never org members (PLATFORM §8.5): there is no bridge, and
 * nothing on this page reads an organization the caller belongs to.
 */
export default async function AdminD17Page() {
  const role = (await currentStaffRole()) as StaffRole;

  const [rows, recon] = await Promise.all([
    // Read the service directly rather than self-fetching the route: same
    // data, one database round trip instead of a loopback HTTP call.
    listD17Queue(QUEUE_STATUSES),
    d17Reconciliation(30),
  ]);

  const canReject = staffAtLeast(role, "admin");
  const waiting = rows.filter((r) => r.status === "proof_submitted").length;

  return (
    <AdminPage>
      <AdminHeader
        title="D17 verification queue"
        description="Approving activates the subscription and pushes the plan's limits to the gateway. Every approval is audited and idempotent."
        actions={
          <>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href="/api/admin/d17/export" />}>
              <Download />
              CSV
            </Button>
            <Badge variant="outline">staff: {role}</Badge>
          </>
        }
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminStat
          label="Waiting for review"
          value={waiting}
          hint={waiting > 0 ? "Money claimed, not yet verified" : "Queue is clear"}
          tone={waiting > 0 ? "warning" : "positive"}
        />
        <AdminStat label="Verified (30 days)" value={recon.totals.count} hint="Approved claims" />
        <AdminStat
          label="Verified amount (30 days)"
          value={`${(recon.totals.totalMillimes / 1000).toFixed(3)} DT`}
          hint="Collected in the last 30 days"
        />
      </dl>

      <div className="mt-8 grid gap-8">
        <D17AdminQueue rows={rows as D17QueueItem[]} canReject={canReject} />
      </div>
    </AdminPage>
  );
}

