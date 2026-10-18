import type { Metadata } from "next";

import { AdminHeader, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { StaffManager } from "@/components/admin/staff-manager";
import { listStaff } from "@/lib/admin/staff";
import { STAFF_ROLE_SUMMARY, STAFF_ROLES } from "@/lib/auth/staff-roles";
import { currentStaffRole, staffAtLeast } from "@/lib/auth/authorize";
import { auth } from "@/auth";
import { db } from "@/db";
import { staffUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/**
 * /admin/staff — who can reach this console.
 *
 * Until 0015 `staff_users` was written only by `scripts/create-accounts.ts`,
 * so granting an operator access meant a shell on the VPS — and so did
 * revoking it. Both now happen here.
 *
 * THE RANK TABLE IS RENDERED UNDER THE TABLE, not just used to gate
 * things. The ladder is documented where it is actually used, so an
 * operator granting `support` can read what that role does instead of
 * guessing from the word.
 */
export default async function AdminStaffPage() {
  const role = await currentStaffRole();
  const canManage = role !== null && staffAtLeast(role, "owner");
  const [staff, session] = await Promise.all([listStaff(), auth()]);

  // The signed-in operator's own id, so the UI can hide the controls
  // that the server will refuse anyway. `currentStaffRole` resolves the
  // ROLE; this resolves the ID.
  const self = session?.user?.email
    ? await db.query.staffUsers.findFirst({
        where: eq(staffUsers.email, session.user.email),
        columns: { id: true },
      })
    : null;

  const active = staff.filter((s) => !s.revokedAt);
  const revoked = staff.filter((s) => s.revokedAt);
  const owners = active.filter((s) => s.role === "owner");
  const missingCredential = active.filter((s) => !s.hasCredential);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <AdminHeader
        title="Staff"
        description="Who can reach the operations console, and what each role is allowed to do."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-4">
        <AdminStat label="Active" value={active.length} hint={`${staff.length} total on record`} />
        <AdminStat
          label="Owners"
          value={owners.length}
          hint={
            owners.length <= 1
              ? "Only one owner — promote another before changing anything"
              : "Can grant and revoke"
          }
          tone={owners.length <= 1 ? "warning" : "neutral"}
        />
        <AdminStat
          label="Revoked"
          value={revoked.length}
          hint="Rows retained so the audit trail survives"
        />
        <AdminStat
          label="No sign-in yet"
          value={missingCredential.length}
          hint="Granted access, but cannot authenticate"
          tone={missingCredential.length > 0 ? "warning" : "positive"}
        />
      </dl>

      <div className="mt-8">
        <AdminSection
          title="Roster"
          description="Revocation takes effect on the operator's next request — there is no session to wait out. The row is never deleted."
        >
          <StaffManager
            staff={staff}
            roles={STAFF_ROLES}
            roleSummary={STAFF_ROLE_SUMMARY}
            canManage={canManage}
            selfId={self?.id ?? null}
          />
        </AdminSection>
      </div>
    </main>
  );
}