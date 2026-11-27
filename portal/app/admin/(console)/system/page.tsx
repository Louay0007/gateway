import type { Metadata } from "next";
import Link from "next/link";

import { RecoveryActions } from "@/components/admin/recovery-actions";
import { AdminEmptyState, AdminHeader, AdminPage, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listLockedIdentities, listUnverifiedCustomers } from "@/lib/admin/system";
import { dateTime } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Account Recovery" };
export const dynamic = "force-dynamic";

/**
 * /admin/system — the two states a customer cannot get out of themselves.
 *
 *   LOCKED OUT. `auth_login_attempts` throttles an identity after repeated
 *   failed sign-ins, with backoff up to an hour. A paying customer who
 *   fat-fingered their password six times waited on a timer while on the phone,
 *   because no operator could clear it.
 *
 *   UNVERIFIED. `email_verified_at` gates checkout and key creation. When the
 *   confirmation mail lands in spam, the customer cannot pay and cannot see
 *   why — the paywall has no message attached to it.
 *
 * Neither action is a password reset, and that is the invariant: staff act ON
 * an account, never AS the person.
 */
export default async function AdminSystemPage() {
  const [lockouts, unverified] = await Promise.all([
    listLockedIdentities(),
    listUnverifiedCustomers(),
  ]);

  return (
    <AdminPage>
      <AdminHeader
        title="Account recovery"
        description="The two states a customer cannot resolve alone. Both are audited; neither can set a password."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <AdminStat
          label="Locked out"
          value={lockouts.length}
          hint="Throttled by failed sign-ins, right now"
          tone={lockouts.length > 0 ? "danger" : "neutral"}
        />
        <AdminStat
          label="Unverified"
          value={unverified.length}
          hint="Cannot check out until they confirm"
          tone={unverified.length > 0 ? "warning" : "neutral"}
        />
      </dl>

      <div className="mt-8 grid gap-8">
        <AdminSection
          title="Locked logins"
          description="Clearing a lock puts the identity in exactly the state a successful sign-in would — it is not a bypass, and the failure count is discarded deliberately."
        >
          {lockouts.length === 0 ? (
            <AdminEmptyState>Nobody is currently throttled.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Identity</TableHead>
                    <TableHead className="text-right">Failures</TableHead>
                    <TableHead>Locked for</TableHead>
                    <TableHead className="pr-4 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lockouts.map((l) => (
                    <TableRow key={l.bucket}>
                      <TableCell className="pl-4 font-medium">{l.identity}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.failures}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Badge variant="destructive" className="mr-2">
                          {Math.ceil(l.lockedForSeconds / 60)} min left
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <RecoveryActions kind="unlock" email={l.identity} label="Unlock" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>

        <AdminSection
          title="Unverified accounts"
          description="Re-sending invalidates any earlier link — one active token per account, the same rule the signup flow follows."
        >
          {unverified.length === 0 ? (
            <AdminEmptyState>Every account has a confirmed address.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Person</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="pr-4 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unverified.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell className="pl-4">
                        <Link href={`/admin/customers/${u.userId}`} className="font-medium hover:underline">
                          {u.name ?? u.email}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{u.email}</span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {u.orgId ? (
                          <Link href={`/admin/orgs/${u.orgId}`} className="underline">
                            {u.orgName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {dateTime(u.createdAt)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <RecoveryActions
                          kind="verification"
                          email={u.email}
                          label="Re-send verification"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>
      </div>
    </AdminPage>
  );
}
