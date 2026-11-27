import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminEmptyState, AdminHeader, AdminPage, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { paymentTone, subStatusTone } from "@/components/admin/badge-tones";
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
import { paymentDetail } from "@/lib/admin/payments";
import { dateTime, usd } from "@/lib/dashboard/format";

export const metadata: Metadata = { title: "Payment Details" };
export const dynamic = "force-dynamic";

/**
 * /admin/payments/[id] — one payment, end to end.
 *
 * Answers the three questions a disputed transfer turns on:
 *
 *   1. WHAT DID WE RECEIVE — amount, authorization number, sender phone, and
 *      the fx snapshot taken at submission (so reconciliation is arithmetic,
 *      not archaeology).
 *   2. WHO DECIDED — the operator who verified it, or the absence of one.
 *   3. WHAT DID THE MACHINE SEE — the automatic verifier's readings (0050),
 *      when the vision pass ran. This is the "was this auto-approved, and
 *      what did it think it read" question no screen could answer.
 */
export default async function AdminPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await paymentDetail(id);
  if (!detail) notFound();

  const { payment, subscription, verifications, rejections } = detail;

  return (
    <AdminPage>
      <AdminHeader
        title="Payment"
        description={`${payment.organizationName} · ${(payment.amountMillimes / 1000).toFixed(3)} ${payment.currency}`}
        actions={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/payments" />}>
            All payments
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={paymentTone(payment.status)}>{payment.status.replace(/_/g, " ")}</Badge>
        <Link href={`/admin/orgs/${payment.organizationId}`} className="text-sm underline">
          {payment.organizationName}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">{payment.id}</span>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-4">
        <AdminStat label="Amount" value={`${(payment.amountMillimes / 1000).toFixed(3)} ${payment.currency}`} hint="As transferred" />
        <AdminStat label="USD at submit" value={usd(payment.usdAmountCents / 100)} hint={`fx ${payment.fxRate}`} />
        <AdminStat
          label="Decided"
          value={payment.verifiedAt ? (payment.verifiedBy ? "by a person" : "by the system") : "—"}
          hint={payment.verifiedAt ? dateTime(payment.verifiedAt) : "still open"}
        />
        <AdminStat
          label="Rejections"
          value={rejections.length}
          hint={rejections.length >= 1 ? "A second rejection is final" : "Resubmit allowed once"}
          tone={rejections.length >= 1 ? "warning" : "neutral"}
        />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <AdminSection title="Transfer" description="What the customer claimed, and how we can identify it at the bank.">
          <dl className="grid gap-3 rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Authorization no.</dt>
              <dd className="font-mono">{payment.authorizationNumber ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Sender phone</dt>
              <dd className="font-mono">{payment.senderPhone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{payment.submittedAt ? dateTime(payment.submittedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Plan</dt>
              <dd>{payment.planCode ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Proof screenshot</dt>
              <dd>
                {payment.hasScreenshot ? (
                  <a
                    href={`/api/admin/d17/${payment.id}/screenshot`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    open
                  </a>
                ) : (
                  <span className="text-muted-foreground">none</span>
                )}
              </dd>
            </div>
            {payment.rejectReason ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Last rejection</dt>
                <dd className="max-w-xs text-right">{payment.rejectReason}</dd>
              </div>
            ) : null}
          </dl>
        </AdminSection>

        <AdminSection title="Subscription" description="The row this payment paid for, and whether an operator has since ended it.">
          {subscription ? (
            <dl className="grid gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={subStatusTone(subscription.status)}>{subscription.status}</Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Plan</dt>
                <dd>{subscription.planCode ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Period</dt>
                <dd className="text-right text-xs">
                  {subscription.currentPeriodStart ? dateTime(subscription.currentPeriodStart) : "—"}
                  {" → "}
                  {subscription.currentPeriodEnd ? dateTime(subscription.currentPeriodEnd) : "—"}
                </dd>
              </div>
              {subscription.removedAt ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Removed by ops</dt>
                  <dd className="text-right text-xs">
                    {dateTime(subscription.removedAt)}
                    {subscription.removalReason ? ` · ${subscription.removalReason}` : ""}
                  </dd>
                </div>
              ) : null}
              <div className="pt-1">
                <Link href={`/admin/orgs/${payment.organizationId}`} className="text-xs underline">
                  Open the account
                </Link>
              </div>
            </dl>
          ) : (
            <AdminEmptyState>This payment has no resolvable subscription.</AdminEmptyState>
          )}
        </AdminSection>
      </div>

      <div className="mt-8">
        <AdminSection
          title="Automatic verification"
          description="What the vision reader reported, and the score it produced. The model reads; the code decides — a reading never approves anything by itself."
        >
          {verifications.length === 0 ? (
            <AdminEmptyState>
              No automatic reading — this proof was reviewed by a person, or the verifier was not
              configured when it arrived.
            </AdminEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Verdict</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="pr-4">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verifications.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="pl-4">
                        <Badge variant={v.verdict === "pass" ? "default" : v.verdict === "fail" ? "destructive" : "secondary"}>
                          {v.verdict}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.score}</TableCell>
                      <TableCell className="text-xs">{v.reason ?? "—"}</TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {dateTime(v.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AdminSection>
      </div>

      {rejections.length > 0 ? (
        <div className="mt-8">
          <AdminSection title="Rejection history" description="Every rejection recorded for this payment, newest first.">
            <ul className="grid gap-2 rounded-xl border border-border bg-card p-4 text-sm">
              {rejections.map((r, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>{r.reason ?? "no reason recorded"}</span>
                  <span className="text-xs text-muted-foreground">{dateTime(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </AdminSection>
        </div>
      ) : null}
    </AdminPage>
  );
}
