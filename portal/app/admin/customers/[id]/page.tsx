import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CustomerRecoveryActions } from "@/components/admin/customer-recovery-actions";
import {
  AdminEmptyState,
  AdminHeader,
  AdminPage,
  AdminSection,
  AdminStat,
} from "@/components/admin/stat-card";
import { subStatusTone, orgStatusTone } from "@/components/admin/badge-tones";
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
import { customerDetail } from "@/lib/admin/customers";
import { compact, dateTime, usd } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Customer Details" };
export const dynamic = "force-dynamic";

/**
 * /admin/customers/[id] — one human, every account they belong to.
 *
 * THIS IS THE PAGE THAT ANSWERS A SUPPORT EMAIL. The org drill-down answers
 * "what is happening to this account"; only this page answers "who is this
 * person and what do they own", which is the question that arrives first.
 *
 * READ-ONLY. Every action on their ACCOUNTS lives on the org drill-down, where
 * the audit row and the gateway push already are. The one exception is the two
 * recovery buttons, which act on the IDENTITY rather than the account — and
 * neither of them can set a password.
 */
export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await customerDetail(id);
  if (!detail) notFound();

  const verified = Boolean(detail.emailVerifiedAt);
  const lockedOut = detail.lockedOut;

  return (
    <AdminPage>
      <AdminHeader
        title={detail.name ?? detail.email}
        description={detail.email}
        actions={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/customers" />}>
            All customers
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {verified ? (
          <Badge variant="secondary">verified {detail.emailVerifiedAt ? dateTime(detail.emailVerifiedAt) : ""}</Badge>
        ) : (
          <Badge variant="outline">unverified — cannot check out</Badge>
        )}
        {lockedOut ? <Badge variant="destructive">locked out</Badge> : null}
        {detail.isStaff ? <Badge variant="outline">holds a staff row</Badge> : null}
        <span className="text-xs text-muted-foreground">joined {dateTime(detail.createdAt)}</span>
      </div>

      {!verified || lockedOut ? (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {lockedOut
              ? "This person is currently throttled out of signing in. Clearing it puts them in the same state a successful sign-in would."
              : "This person cannot check out until they confirm their address. Re-sending invalidates any earlier link."}
          </p>
          <CustomerRecoveryActions email={detail.email} lockedOut={lockedOut} verified={verified} />
        </div>
      ) : null}

      <dl className="mt-6 grid gap-4 sm:grid-cols-4">
        <AdminStat label="Organizations" value={detail.totals.orgCount} hint="Accounts this person belongs to" />
        <AdminStat label="Active keys" value={detail.totals.activeKeys} hint="Across all their accounts" />
        <AdminStat label="Revenue, 30d" value={usd(detail.totals.revenue30dUsd)} hint="Metered customer spend" />
        <AdminStat label="Payments" value={detail.totals.paymentCount} hint="D17 rows, all time" />
      </dl>

      <div className="mt-8 grid gap-8">
        <AdminSection
          title="Organizations"
          description="Every account this person belongs to, with their role in each. Click through to act on one."
        >
          {detail.orgs.length === 0 ? (
            <AdminEmptyState>
              This person belongs to no organization. Provisioning creates a personal one on
              their first product request, so a brand-new account can briefly sit here.
            </AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Account</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.orgs.map((o) => (
                    <TableRow key={o.orgId}>
                      <TableCell className="pl-4">
                        <Link href={`/admin/orgs/${o.orgId}`} className="font-medium hover:underline">
                          {o.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">{o.slug}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{o.role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{o.planCode ?? <span className="text-muted-foreground">none</span>}</TableCell>
                      <TableCell>
                        <Badge variant={orgStatusTone(o.status)}>{o.status}</Badge>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Link href={`/admin/orgs/${o.orgId}`} className="text-sm underline">
                          Open
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>

        <div className="grid gap-8 lg:grid-cols-2">
          <AdminSection
            title="Console access"
            description="Staff rows are separate from customer accounts — a staff member is never an org member."
          >
            {detail.staff ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm">
                <p className="font-medium">
                  {detail.staff.username ?? "no username"}
                  {detail.staff.revokedAt ? (
                    <Badge variant="destructive" className="ml-2">
                      revoked
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  role {detail.staff.role} · manage from{" "}
                  <Link href="/admin/staff" className="underline">
                    Staff
                  </Link>
                </p>
              </div>
            ) : (
              <AdminEmptyState>Not a staff member.</AdminEmptyState>
            )}
          </AdminSection>

          <AdminSection
            title="Login state"
            description="The throttle bucket is what locks a person out after repeated failed sign-ins."
          >
            {detail.throttle ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm">
                <p>
                  {detail.throttle.failures} consecutive failure
                  {detail.throttle.failures === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {detail.throttle.lockedUntil
                    ? `locked until ${dateTime(detail.throttle.lockedUntil)}`
                    : "not currently locked"}
                </p>
              </div>
            ) : (
              <AdminEmptyState>No failed sign-ins recorded.</AdminEmptyState>
            )}
          </AdminSection>
        </div>

        <AdminSection
          title="Recent history"
          description="Audit entries across every account this person belongs to, newest first."
        >
          {detail.recentAudit.length === 0 ? (
            <AdminEmptyState>Nothing recorded for this person's accounts yet.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Action</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="pr-4">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.recentAudit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="pl-4 font-mono text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs">
                        {a.organizationId ? (
                          <Link href={`/admin/orgs/${a.organizationId}`} className="underline">
                            open
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {dateTime(a.createdAt)}
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
