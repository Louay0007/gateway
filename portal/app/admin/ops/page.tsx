import type { Metadata } from "next";

import { AdminHeader, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { jobHealth, ledgerFreshness, standingAlerts } from "@/lib/admin/ops";
import { dateTime, relativeTime } from "@/lib/dashboard/format";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

/**
 * /admin/ops — is the system telling the truth?
 *
 * Three things, because together they answer one question: can I trust
 * the numbers on the other screens?
 *
 *   LEDGER FRESHNESS — usage is collected on a schedule, not streamed.
 *     When `collect_usage` dies nothing raises; the ledger just stops
 *     growing and the first sign is a customer saying their invoice looks
 *     wrong. Checking the collector BEFORE arguing with a customer about
 *     an amount is the difference between fixing a bug and apologising
 *     for one.
 *
 *   JOB HEALTH — the same failure seen from the cause rather than the
 *     symptom. `stale` is a loose threshold on purpose: the runner is
 *     invoked by `make jobs` on a human schedule as well as by the timer,
 *     so a missed interval often just means nobody has run it yet.
 *
 *   ALERTS — `system_alerts` is a STATE table, not a log. A cleared
 *     anomaly deletes its row, so an empty list means "nothing standing"
 *     rather than "nothing has ever happened".
 */
export default async function AdminOpsPage() {
  const [jobs, alerts, freshness] = await Promise.all([
    jobHealth(),
    standingAlerts(),
    ledgerFreshness(),
  ]);

  const stale = jobs.filter((j) => j.stale || j.locked);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <AdminHeader
        title="Pipeline"
        description="Job health and ledger freshness. Usage is collected on a schedule, not streamed — if the collector has stopped, the money numbers are stale."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat
          label="Ledger freshness"
          value={freshness.newestUsageAt === null ? null : relativeTime(freshness.newestUsageAt)}
          hint={
            freshness.newestUsageAt === null
              ? "No usage collected yet"
              : `Newest row ${dateTime(freshness.newestUsageAt)}`
          }
          tone={freshness.fresh ? "positive" : "danger"}
        />
        <AdminStat
          label="Jobs needing attention"
          value={stale.length}
          hint={stale.length === 0 ? "Every job is current" : stale.map((j) => j.name).join(", ")}
          tone={stale.length === 0 ? "positive" : "warning"}
        />
        <AdminStat
          label="Money-risk alerts"
          value={alerts.filter((a) => a.kind === "anomaly").length}
          hint="Multi-org phones, proof bursts, cap breaches"
          tone={alerts.some((a) => a.kind === "anomaly") ? "danger" : "positive"}
        />
        <AdminStat
          label="Ops alerts"
          value={alerts.filter((a) => a.kind === "ops").length}
          hint="Collector lag, failed syncs, job errors"
          tone={alerts.some((a) => a.kind === "ops") ? "warning" : "positive"}
        />
      </dl>

      <div className="mt-8">
        <AdminSection
          title="Jobs"
          description="A lock older than 15 minutes is a crashed runner holding the claim, not a running job."
        >
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Job</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead className="pr-6">Last error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.name}>
                    <TableCell className="pl-6 font-mono text-xs">{j.name}</TableCell>
                    <TableCell>
                      {j.locked && !j.stale ? (
                        <Badge variant="default">running</Badge>
                      ) : j.stale ? (
                        <Badge variant="outline">stale</Badge>
                      ) : (
                        <Badge variant="secondary">ok</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {j.lastRunAt ? (
                        <>
                          {relativeTime(j.lastRunAt)}
                          <span className="block">{dateTime(j.lastRunAt)}</span>
                        </>
                      ) : (
                        "never"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{j.attempts}</TableCell>
                    <TableCell className="pr-6 max-w-md">
                      {j.lastError ? (
                        <p className="truncate font-mono text-xs text-destructive" title={j.lastError}>
                          {j.lastError}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </AdminSection>
      </div>

      <div className="mt-8">
        <AdminSection
          title="Standing alerts"
          description="One row per condition. A cleared anomaly deletes its row, so an empty list means nothing is standing — not that nothing ever happened."
        >
          {alerts.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing standing. No alerts are active.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {alerts.map((a) => (
                <li key={a.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.lastState}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.kind === "anomaly" ? "destructive" : "secondary"}>
                      {a.kind}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {a.lastSentAt ? relativeTime(a.lastSentAt) : "not mailed"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </div>
    </main>
  );
}