import type { Metadata } from "next";
import Link from "next/link";

import { AdminHeader, AdminStat } from "@/components/admin/stat-card";
import { orgEconomics } from "@/lib/admin/financials";
import { compact, usd } from "@/lib/dashboard/format";

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
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Usage & Margin Analytics" };
export const dynamic = "force-dynamic";

/**
 * /admin/usage — cross-org usage and per-account economics.
 *
 * The customer `/api/usage` cannot answer this: it is scoped by
 * `requireActiveOrg()` to the caller's own account, so "which accounts
 * are burning money?" had no route anywhere in the product.
 *
 * ORDERED BY REVENUE, NOT CALL COUNT — the sort is the feature. An
 * account making 10,000 cheap calls is less interesting than one
 * making 200 expensive ones, and only a revenue sort makes that visible
 * at a glance.
 *
 * Every figure is an ALIAS (`fast`, `smart`, `frontier`), never a raw
 * upstream model name — the product invariant from CONTEXT.md §1. The
 * ledger only stores aliases, so there is nothing else here to show.
 */
export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const windowDays = Math.min(365, Math.max(1, Number(one("window") ?? "30") || 30));

  const rows = await orgEconomics(windowDays, 100);

  const totalRevenue = rows.reduce((a, r) => a + r.usageRevenueUsd, 0);
  const totalUpstream = rows.reduce((a, r) => a + r.upstreamCostUsd, 0);
  const totalRequests = rows.reduce((a, r) => a + r.requests, 0);
  const totalPrompts = rows.reduce((a, r) => a + (r.prompts ?? 0), 0);
  const marginPct = totalRevenue > 0 ? ((totalRevenue - totalUpstream) / totalRevenue) * 100 : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <AdminHeader
        title="Usage & margin"
        description="Who is spending, and what it costs us to serve them. Every figure is a model alias — no upstream model name is ever exposed."
      />

      <form method="get" action="/admin/usage" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="grid gap-1.5 text-xs font-medium">
          Window (days)
          <Input
            type="number"
            name="window"
            min={1}
            max={365}
            defaultValue={windowDays}
            className="h-9 w-28"
          />
        </label>
        <Button type="submit" size="sm">Apply</Button>
        {[7, 30, 90].map((d) => (
          <Button
            key={d}
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/admin/usage?window=${d}`} />}
          >
            {d}d
          </Button>
        ))}
      </form>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <AdminStat label="Revenue (listed)" value={usd(totalRevenue)} hint={`Top ${rows.length} accounts by revenue`} />
        <AdminStat label="Upstream cost" value={usd(totalUpstream)} hint="What those tokens cost" />
        <AdminStat
          label="Margin"
          value={marginPct === null ? null : `${marginPct.toFixed(1)}%`}
          hint={marginPct === null ? "No metered revenue in the window" : usd(totalRevenue - totalUpstream)}
          tone={marginPct === null ? "neutral" : marginPct > 0 ? "positive" : "danger"}
        />
        <AdminStat label="Prompts" value={compact(totalPrompts)} hint={`Last ${windowDays} days · quota`} />
        <AdminStat label="Requests" value={compact(totalRequests)} hint={`Last ${windowDays} days · incl. failures`} />
      </dl>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No usage has been recorded in this window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Account</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Prompts</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Upstream</TableHead>
                <TableHead className="pr-6 text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const m = r.usageRevenueUsd > 0
                  ? ((r.grossMarginUsd / r.usageRevenueUsd) * 100).toFixed(1)
                  : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-6 font-medium">
                      <a href={`/admin/orgs/${r.id}`} className="hover:underline">
                        {r.name}
                      </a>
                      <span className="block font-mono text-xs text-muted-foreground">{r.slug}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.planCode ?? "no plan"}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{r.prompts.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.requests.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{compact(r.inputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{compact(r.outputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{compact(r.cacheReadTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.usageRevenueUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{usd(r.upstreamCostUsd)}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{m === null ? "—" : `${m}%`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </main>
  );
}