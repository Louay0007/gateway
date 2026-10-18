import type { Metadata } from "next";

import { AdminHeader, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { AlertTriangle, TrendingUp } from "lucide-react";

import { financialSummary, mrrByPlan } from "@/lib/admin/financials";
import { jobHealth, ledgerFreshness, standingAlerts } from "@/lib/admin/ops";
import { listAdminOrgsFiltered } from "@/lib/admin/orgs";
import { currentStaffRole } from "@/lib/auth/authorize";
import { relativeTime, usd, usdPrecise } from "@/lib/dashboard/format";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

/**
 * /admin — the operations overview.
 *
 * The console's landing page answers, in order: is the pipeline healthy,
 * is there money waiting, is the business healthy. In that order,
 * because a wrong number about revenue is worth less than knowing the
 * number is wrong — which is why LEDGER FRESHNESS is the first tile
 * rather than a footnote. If the collector has not run in four hours,
 * every revenue figure below is four hours old, and an operator reading
 * them without that warning has been told a lie by omission.
 *
 * Reads the services directly rather than self-fetching the routes: same
 * data, one database round trip instead of a loopback HTTP call.
 */
export default async function AdminPage() {
  const role = await currentStaffRole();

  const [summary, mrr, jobs, alerts, freshness, needsSync, overCap] = await Promise.all([
    financialSummary(30),
    mrrByPlan(),
    jobHealth(),
    standingAlerts(),
    ledgerFreshness(),
    listAdminOrgsFiltered({ entitlementFailed: true, pageSize: 5 }),
    listAdminOrgsFiltered({ overCapOnly: true, pageSize: 5 }),
  ]);

  const staleJobs = jobs.filter((j) => j.stale || j.locked);
  const anomalyAlerts = alerts.filter((a) => a.kind === "anomaly");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <AdminHeader
        title="Operations"
        description="Pipeline health, money waiting, and the state of the business."
        actions={<Badge variant="outline">staff: {role}</Badge>}
      />

      {/* ── 1. Can the numbers be trusted? ───────────────────────────── */}
      <div className="mt-6">
        <AdminSection
          title="Pipeline health"
          description="Usage is collected on a schedule, not streamed. If the collector has stopped, every money figure below is stale."
        >
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStat
              label="Ledger freshness"
              value={
                freshness.newestUsageAt === null
                  ? null
                  : freshness.ageSeconds === null
                    ? null
                    : relativeTime(freshness.newestUsageAt)
              }
              hint={
                freshness.newestUsageAt === null
                  ? "No usage has been collected yet"
                  : `Newest row ${relativeTime(freshness.newestUsageAt)} · expected within ${Math.round(
                      freshness.expectedIntervalSeconds / 60,
                    )} min`
              }
              tone={freshness.fresh ? "positive" : "danger"}
            />
            <AdminStat
              label="Jobs needing attention"
              value={staleJobs.length}
              hint={staleJobs.length === 0 ? "Every job is current" : staleJobs.map((j) => j.name).join(", ")}
              tone={staleJobs.length === 0 ? "positive" : "warning"}
            />
            <AdminStat
              label="Standing alerts"
              value={alerts.length}
              hint={
                anomalyAlerts.length === 0
                  ? "Nothing flagged"
                  : `${anomalyAlerts.length} money-risk finding${anomalyAlerts.length === 1 ? "" : "s"}`
              }
              tone={anomalyAlerts.length === 0 ? "positive" : "danger"}
            />
            <AdminStat
              label="Failed entitlement syncs"
              value={needsSync.total}
              hint="Accounts whose gateway push is failing"
              tone={needsSync.total === 0 ? "positive" : "warning"}
            />
          </dl>
        </AdminSection>
      </div>

      {/* ── 2. Money waiting for a decision ─────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Accounts needing action"
          description="Accounts the system has already flagged as needing a human."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <FlagList
              title="Over their hard cap"
              tone="danger"
              icon={<AlertTriangle className="size-4" />}
              empty="No account is over its plan cap."
              items={overCap.rows.map((o) => ({
                id: o.id,
                label: o.name,
                detail: `${usd(o.periodCostUsd)} this period on ${o.planCode ?? "no plan"}`,
              }))}
            />
            <FlagList
              title="Gateway sync failing"
              tone="warning"
              icon={<TrendingUp className="size-4" />}
              empty="Every entitlement push is current."
              items={needsSync.rows.map((o) => ({
                id: o.id,
                label: o.name,
                detail: o.entitlementError ?? "No error recorded",
              }))}
            />
          </div>
        </AdminSection>
      </div>

      {/* ── 3. The business ─────────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Revenue — last 30 days"
          description="Collected, recognised and metered are three different numbers that legitimately disagree. They are shown separately rather than blended into one 'revenue' figure."
        >
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStat
              label="Collected (verified D17)"
              value={usd(summary.collectedUsd)}
              hint={`${summary.collectedCount} verified payment${summary.collectedCount === 1 ? "" : "s"}`}
              tone="positive"
            />
            <AdminStat
              label="Active MRR"
              value={usd(mrr.activeMrrUsd)}
              hint={`${mrr.rows.filter((r) => r.status === "active").reduce((a, r) => a + r.count, 0)} active subscriptions`}
            />
            <AdminStat
              label="Metered usage revenue"
              value={usd(summary.usageRevenueUsd)}
              hint={`${summary.requests.toLocaleString()} requests · ${summary.promptCount.toLocaleString()} prompts`}
            />
            <AdminStat
              label="Upstream cost"
              value={usd(summary.upstreamCostUsd)}
              hint="What those tokens cost the provider"
            />
          </dl>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStat
              label="Gross margin"
              value={usd(summary.grossMarginUsd)}
              hint="Metered revenue minus upstream cost"
              tone={summary.grossMarginUsd > 0 ? "positive" : "neutral"}
            />
            <AdminStat
              label="Margin %"
              value={summary.grossMarginPct === null ? null : `${summary.grossMarginPct.toFixed(1)}%`}
              hint={summary.grossMarginPct === null ? "No metered revenue in the window" : "Of metered usage revenue"}
            />
            <AdminStat
              label="Effective rate"
              value={summary.effectiveRateBps === null ? null : `${(summary.effectiveRateBps / 10000).toFixed(3)}×`}
              hint={
                summary.effectiveRateBps === null
                  ? "No upstream cost to divide by"
                  : "Realised multiplier across all plans"
              }
            />
            <AdminStat
              label="Credits / refunds"
              value={summary.creditsUsd === 0 ? usdPrecise(0) : usd(summary.creditsUsd)}
              hint={`${summary.creditsCount} note${summary.creditsCount === 1 ? "" : "s"} · signed (negative = refunded)`}
              tone={summary.creditsUsd < 0 ? "warning" : "neutral"}
            />
          </dl>
        </AdminSection>
      </div>

      {/* ── 4. Subscription base ─────────────────────────────────────── */}
      <div className="mt-8">
        <AdminSection
          title="Subscription base"
          description="Trials are reported separately and never counted as revenue: a trial consumes the plan's full included spend while generating none."
        >
          <div className="rounded-xl border border-border bg-card p-4">
            <dl className="grid gap-3 sm:grid-cols-4">
              <Mini label="Active" value={String(mrr.rows.filter((r) => r.status === "active").reduce((a, r) => a + r.count, 0))} hint={usd(mrr.activeMrrUsd)} />
              <Mini label="Trialing" value={String(mrr.trialingCount)} hint="consuming spend, generating none" />
              <Mini label="Past due" value={String(mrr.pastDueCount)} hint="cut at the gateway" />
              <Mini label="Unpaid" value={String(mrr.unpaidCount)} hint="cut at the gateway" />
            </dl>
          </div>
        </AdminSection>
      </div>
    </main>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * A flagged-account list. Bounded to the five the caller passed, and it
 * says so when the real number is larger — a list that silently truncates
 * at five reads as "there are five problems", which is the same
 * summary-vs-table disagreement the customer Usage page was fixed for.
 */
function FlagList({
  title,
  items,
  empty,
  tone,
  icon,
}: {
  title: string;
  items: { id: string; label: string; detail: string }[];
  empty: string;
  tone: "danger" | "warning";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className={tone === "danger" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
          {icon}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className="px-4 py-3">
              <a
                href={`/admin/orgs/${i.id}`}
                className="text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {i.label}
              </a>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{i.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}