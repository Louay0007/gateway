import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";

import { D17AdminQueue, type D17QueueItem } from "@/components/d17/d17-admin-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentStaffRole, staffAtLeast, type StaffRole } from "@/lib/auth/authorize";
import { d17Reconciliation, listD17Queue } from "@/lib/billing/d17-admin";

const QUEUE_STATUSES = ["proof_submitted", "rejected", "paid", "expired"];

export const metadata: Metadata = { title: "D17 verification queue" };
export const dynamic = "force-dynamic";

/**
 * /admin/d17 — the manual-payment verification desk.
 *
 * The page the sidebar has always linked to, which 404'd because the
 * frontend rebuild deleted it. Approving here is the ONLY thing that turns
 * a D17 transfer into a live subscription: there is no webhook to call
 * (`d17.ts:verify()` throws by design), so without this page and the two
 * routes behind it, every submitted payment sat in `proof_submitted`
 * forever.
 *
 * STAFF ONLY, enforced here as well as in the routes. `requireStaff`
 * throws; a page renders rather than redirects so an operator who landed
 * here without the role is told why instead of being bounced to a
 * dashboard that has no queue. The routes remain the authority — this
 * gate is so the page does not leak the existence of the queue to
 * customers.
 *
 * Staff are never org members (PLATFORM §8.5): there is no bridge, and
 * nothing on this page reads an organization the caller belongs to.
 */
export default async function AdminD17Page() {
  const role = await currentStaffRole();

  if (!role) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <h1 className="text-xl font-semibold tracking-tight">Staff access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is the payment verification queue for the operations
          team. It is not part of a customer account.
        </p>
        <div className="mt-6">
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  const [rows, recon] = await Promise.all([
    // Read the service directly rather than self-fetching the route: same
    // data, one database round trip instead of a loopback HTTP call.
    listD17Queue(QUEUE_STATUSES),
    d17Reconciliation(30),
  ]);

  const canReject = staffAtLeast(role as StaffRole, "admin");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">D17 verification queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approving activates the subscription and pushes the plan&apos;s
            limits to the gateway. Every approval is audited and idempotent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<a href="/api/admin/d17/export" />}>
            <Download />
            CSV
          </Button>
          <Badge variant="outline">staff: {role}</Badge>
        </div>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Waiting for review" value={String(rows.filter((r) => r.status === 'proof_submitted').length)} />
        <Stat label="Verified (30 days)" value={String(recon.totals.count)} />
        <Stat
          label="Verified amount (30 days)"
          value={`${(recon.totals.totalMillimes / 1000).toFixed(3)} DT`}
        />
      </dl>

      <div className="mt-8 grid gap-8">
        <D17AdminQueue rows={rows as D17QueueItem[]} canReject={canReject} />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}