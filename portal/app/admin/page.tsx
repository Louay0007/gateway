import type { Metadata } from "next";
import Link from "next/link";

import { AdminOrgs, type AdminOrgItem } from "@/components/admin/admin-orgs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentStaffRole, staffAtLeast, type StaffRole } from "@/lib/auth/authorize";
import { listAdminOrgs } from "@/lib/billing/admin-console";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

/**
 * /admin — the operations console.
 *
 * The org list every manual staff power acts on: suspend / reactivate an
 * account, re-push a failed entitlement sync, record a credit note. Staff
 * only, enforced here AND in every route behind it — a page renders
 * rather than redirects so an operator who landed here without the role
 * is told why, and the routes remain the authority.
 *
 * Reads the service directly rather than self-fetching the route: same
 * data, one database round trip instead of a loopback HTTP call.
 */
export default async function AdminPage() {
  const role = await currentStaffRole();

  if (!role) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <h1 className="text-xl font-semibold tracking-tight">Staff access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is the operations console for the staff team. It is not
          part of a customer account.
        </p>
        <div className="mt-6">
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  const orgs = await listAdminOrgs();
  const canManage = staffAtLeast(role as StaffRole, "admin");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suspend or reactivate an account, re-push a failed entitlement
            sync, and record manual credit notes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/admin/d17" />}
          >
            D17 queue
          </Button>
          <Badge variant="outline">staff: {role}</Badge>
        </div>
      </div>

      <div className="mt-6">
        <AdminOrgs orgs={orgs satisfies AdminOrgItem[]} canManage={canManage} />
      </div>
    </main>
  );
}
