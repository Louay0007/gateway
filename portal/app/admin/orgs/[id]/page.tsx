import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminEmptyState,
  AdminHeader,
  AdminPage,
  AdminSection,
  AdminStat,
} from "@/components/admin/stat-card";
import { AccountNotes } from "@/components/admin/account-notes";
import { KeyRevoke } from "@/components/admin/key-revoke";
import { AdminOrgs } from "@/components/admin/admin-orgs";
import { SubscriptionLifecycle } from "@/components/admin/subscription-lifecycle";
import { amountTone, paymentTone, subStatusTone } from "@/components/admin/badge-tones";
import { adminOrgDetail } from "@/lib/admin/orgs";
import { listPlansAdmin } from "@/lib/admin/plans";
import { currentStaffRole, staffAtLeast } from "@/lib/auth/authorize";
import { dateTime, formatCredit, relativeTime, usd } from "@/lib/dashboard/format";

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

export const metadata: Metadata = { title: "Organization Details" };
export const dynamic = "force-dynamic";

/**
 * /admin/orgs/[id] — the operator's drill-down.
 *
 * This is the page the console was missing: everything about ONE account
 * in one place, which is what an operator actually needs when a customer
 * says "your numbers are wrong". Previously the console could list
 * accounts and change their status, but there was nowhere to LOOK — no
 * keys, no payments, no credits, no history.
 *
 * The money column is per-period and the upstream column sits beside it
 * on purpose. An operator looking at a suspicious invoice needs to see
 * the margin under it, because "we billed you $200" and "that cost us
 * $77" together are an answer, while the first alone is an accusation.
 *
 * `<AdminOrgs>` is reused here rather than reimplemented: the suspend /
 * reactivate / retry / credit actions are identical on the roster and on
 * the detail page, and two copies of money-moving UI is two copies to
 * keep correct.
 */
export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, plans, role] = await Promise.all([
    adminOrgDetail(id),
    listPlansAdmin(),
    currentStaffRole(),
  ]);
  if (!detail) notFound();

  const { org, members, keys, subscriptions, credits, payments, recentAudit, notes, devices, removal } =
    detail;
  const canManage = role !== null && staffAtLeast(role, "admin");
  const canOwner = role !== null && staffAtLeast(role, "owner");
  // The row the lifecycle controls act on: the same one the entitlement sync
  // would pick (live first, then newest), so the buttons and the gateway
  // cannot disagree about "the subscription".
  const currentSub = subscriptions[0] ?? null;
  const marginPct =
    org.periodCostUsd > 0
      ? ((org.periodCostUsd - org.periodCostUpstreamUsd) / org.periodCostUsd) * 100
      : null;
  const overCap = org.hardCapCents !== null && org.periodCostUsd * 100 > org.hardCapCents;

  return (
    <AdminPage>
      <AdminHeader
        title={org.name}
        description={`${org.slug} · created ${dateTime(org.createdAt)}`}
        actions={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/orgs" />}>
            All accounts
          </Button>
        }
      />

      {/* ── Money ───────────────────────────────────────────────────── */}
      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat
          label="Period revenue"
          value={usd(org.periodCostUsd)}
          hint={
            org.hardCapCents === null
              ? "No hard cap on this plan"
              : `Cap ${usd(org.hardCapCents / 100)}`
          }
          tone={overCap ? "danger" : "neutral"}
        />
        <AdminStat
          label="Upstream cost"
          value={usd(org.periodCostUpstreamUsd)}
          hint="What those tokens cost"
        />
        <AdminStat
          label="Margin"
          value={marginPct === null ? null : `${marginPct.toFixed(1)}%`}
          hint={
            marginPct === null
              ? "No metered revenue in the period"
              : `${usd(org.periodCostUsd - org.periodCostUpstreamUsd)} gross`
          }
          tone={marginPct === null ? "neutral" : marginPct > 0 ? "positive" : "danger"}
        />
        <AdminStat
          label="Active keys"
          value={org.keyCount}
          hint={`${org.planCode ?? "no plan"} · ${org.subStatus ?? "no subscription"}`}
        />
      </dl>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Actions"
          description="Suspension is enforced through the entitlement sync, so it is a real gateway cut rather than a flag."
        >
          <AdminOrgs orgs={[org]} canManage={canManage} plans={plans} showDetail={false} />

          {currentSub ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Subscription — {currentSub.planCode ?? "no plan"} · {currentSub.status}
                {currentSub.currentPeriodEnd ? ` · ends ${dateTime(currentSub.currentPeriodEnd)}` : ""}
              </p>
              <SubscriptionLifecycle
                orgId={org.id}
                status={currentSub.status}
                cancelAtPeriodEnd={currentSub.cancelAtPeriodEnd}
                canAdmin={canManage}
                canOwner={canOwner}
              />
              {removal ? (
                <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  Removed by an operator on {dateTime(removal.at)}
                  {removal.reason ? ` — “${removal.reason}”` : ""}. The row and its payment history
                  are kept.
                </p>
              ) : null}
            </div>
          ) : null}
        </AdminSection>
      </div>

      {/* ── Keys ────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection title="API keys" description="Prefixes only — key material is never stored in readable form and never returned by this surface.">
          {keys.length === 0 ? (
            <AdminEmptyState>No keys have been created for this account.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="pl-4 font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs">{k.keyPrefix}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{k.kind}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{dateTime(k.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={k.revokedAt ? "destructive" : "default"}>
                          {k.revokedAt ? "revoked" : "active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <KeyRevoke
                          orgId={org.id}
                          keyId={k.id}
                          keyName={k.name}
                          keyPrefix={k.keyPrefix}
                          disabled={canManage === false || k.revokedAt !== null}
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

      {/* ── Members + subscriptions ─────────────────────────────────── */}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <AdminSection title="Members">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Person</TableHead>
                  <TableHead className="pr-4">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="pl-4">
                      <Link href={`/admin/customers/${m.userId}`} className="font-medium hover:underline">
                        {m.name ?? m.email}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{m.email}</span>
                      {!m.emailVerifiedAt ? (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          unverified
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Badge variant="secondary">{m.role}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </AdminSection>

        <AdminSection title="Subscriptions">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="pr-4">Ends</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4">
                      <Badge variant="secondary">{s.planCode ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={subStatusTone(s.status)}>{s.status}</Badge>
                      {s.cancelAtPeriodEnd ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          cancels at period end
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.currentPeriodStart ? dateTime(s.currentPeriodStart) : "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-xs text-muted-foreground">
                      {s.currentPeriodEnd ? dateTime(s.currentPeriodEnd) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </AdminSection>
      </div>

      {/* ── Operator notes ──────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Notes"
          description="What the last operator learned. Append-and-pin only — a wrong note is corrected by a later one, never edited."
        >
          <AccountNotes
            orgId={org.id}
            notes={notes.map((n) => ({
              id: n.id,
              authorUsername: n.authorUsername,
              body: n.body,
              kind: n.kind,
              pinned: n.pinned,
              createdAt: n.createdAt,
            }))}
            canWrite={role !== null && staffAtLeast(role, "support")}
          />
        </AdminSection>
      </div>

      {/* ── Desktop sign-ins ────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Devices"
          description="Machines that signed in through the desktop flow. Revoking one revokes the key it was issued — the key is what authenticates."
        >
          {devices.length === 0 ? (
            <AdminEmptyState>No desktop sign-ins for this account.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Machine</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="pr-4 text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="pl-4 font-medium">
                        {d.deviceName ?? "unnamed"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {d.userEmail ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.userCode}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            d.status === "consumed"
                              ? "default"
                              : d.status === "revoked" || d.status === "expired"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {d.status}
                        </Badge>
                        {d.keyRevoked ? (
                          <span className="mt-1 block text-[10px] text-muted-foreground">key revoked</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                        {dateTime(d.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>
      </div>

      {/* ── Credits ─────────────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Credit notes"
          description="Append-only. Negative refunded the customer; positive credited their next bill."
        >
          {credits.length === 0 ? (
            <AdminEmptyState>No credits or refunds have been recorded.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead className="pr-4">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell
                        className={`pl-4 font-medium tabular-nums ${amountTone(c.amountCents)}`}
                      >
                        {c.amountCents < 0 ? "−" : "+"}
                        {formatCredit(c.amountCents, c.currency)}
                      </TableCell>
                      <TableCell className="max-w-md text-sm">{c.reason}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.createdBy}
                      </TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {dateTime(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>
      </div>

      {/* ── Payments ────────────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection title="D17 payments" description="Every transfer this account has claimed, verified or had rejected.">
          {payments.length === 0 ? (
            <AdminEmptyState>No payments have been submitted.</AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Amount</TableHead>
                    <TableHead>Authorization</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 font-medium tabular-nums">
                        {(p.amountMillimes / 1000).toFixed(3)} DT
                        <span className="block text-xs text-muted-foreground">
                          {usd(p.usdAmountCents / 100)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.authorizationNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.submittedAt ? dateTime(p.submittedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.verifiedAt ? dateTime(p.verifiedAt) : "—"}
                      </TableCell>
                      <TableCell className="pr-4">
                        <Badge variant={paymentTone(p.status)}>{p.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>
      </div>

      {/* ── Audit ──────────────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Recent history"
          description="The last 25 recorded events for this account."
          action={
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/admin/audit?organization=${org.id}`} />}>
              Full audit
            </Button>
          }
        >
          {recentAudit.length === 0 ? (
            <AdminEmptyState>Nothing has been recorded against this account yet.</AdminEmptyState>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {recentAudit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.actorType === "user" ? "staff" : a.actorType} · {dateTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </div>
    </AdminPage>
  );
}