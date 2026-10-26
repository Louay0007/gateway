"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Boxes, Database, Download, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/dashboard/stat-card";
import { QuotaExhaustedBanner } from "@/components/dashboard/quota-meter";
import { UsageAreaChart } from "@/components/dashboard/usage-area-chart";
import {
  ErrorState,
  NoResultsState,
  PanelSkeleton,
  RefreshingBar,
} from "@/components/dashboard/states";
import { useApi } from "@/lib/api/use-api";
import type {
  KeyView,
  SubscriptionBundle,
  UsagePageResponse,
  UsageSeriesResponse,
} from "@/lib/api/types";
import { compact, dateTime, rangeLabel } from "@/lib/dashboard/format";

const PAGE_SIZE = 25;

/**
 * UsageView — the ledger, live.
 *
 * Was reading `mockUsageRows` and filtering in the browser, so "412
 * rows" meant "412 of the 36 rows I invented". Every filter now runs in
 * SQL through `GET /api/usage`, which means three things become true:
 *
 *   - `total` is a fact about the database, so pagination is real and the
 *     summary cards are computed from the same WHERE as the table;
 *   - the key column works, because the endpoint joins `api_keys` for
 *     `keyName` — the old version mapped mock ids through a hardcoded
 *     `KEY_LABELS` record and would have shown "—" on every live row;
 *   - filters live in the URL, so Back and refresh behave (a filtered view
 *     that resets on refresh is broken, per the UX checklist).
 *
 * THE LATENCY COLUMN IS GONE, DELIBERATELY. The collector writes
 * `latency_ms` as NULL — latency is not measured — so the old column
 * rendered " ms" and the old "Avg latency" card rendered a fabricated
 * number with a real unit. Showing a metric the system does not have is
 * worse than not showing it. Cached-read tokens replaced it: those are in
 * the ledger, and on this workload they are the interesting number.
 */
export function UsageView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const range = params.get("range") ?? "30";
  const model = params.get("model") ?? "all";
  const keyId = params.get("key") ?? "all";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const query = React.useMemo(() => {
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", String(PAGE_SIZE));

    // The endpoint takes `from`/`to` datetimes, not a day count. Computed
    // here because the URL is the source of truth for the view: a shared
    // link to "last 7 days" resolves to the same window on the server
    // (relative to when it is opened, which is the honest reading of a
    // rolling window).
    const days = Number(range) || 30;
    if (days !== 30) {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      q.set("from", from.toISOString());
      q.set("to", to.toISOString());
    }

    if (model !== "all") q.set("model", model);
    if (keyId !== "all") q.set("apiKeyId", keyId);
    return q.toString();
  }, [page, range, model, keyId]);

  const usage = useApi<UsagePageResponse>(`/api/usage?${query}`);

  /**
   * The chart series — the SAME window and filters as the table, bucketed
   * in the database. The chart used to re-bucket one page of rows in the
   * browser, which meant a range never wider than a page and quiet days
   * silently missing. `bucket=day` throughout: the UI's smallest window is
   * 7 days, and hour buckets are for a future drill-down.
   */
  const summaryQuery = React.useMemo(() => {
    const q = new URLSearchParams();
    q.set("bucket", "day");
    const days = Number(range) || 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    q.set("from", from.toISOString());
    q.set("to", to.toISOString());
    if (model !== "all") q.set("model", model);
    if (keyId !== "all") q.set("apiKeyId", keyId);
    return q.toString();
  }, [range, model, keyId]);
  const series = useApi<UsageSeriesResponse>(`/api/usage/summary?${summaryQuery}`);

  /**
   * The export's query string — the filters WITHOUT the pagination, since
   * a CSV has one page and the endpoint streams.
   */
  const exportQuery = React.useMemo(() => {
    const q = new URLSearchParams();
    const days = Number(range) || 30;
    if (days !== 30) {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      q.set("from", from.toISOString());
      q.set("to", to.toISOString());
    }
    if (model !== "all") q.set("model", model);
    if (keyId !== "all") q.set("apiKeyId", keyId);
    return q.toString();
  }, [range, model, keyId]);
  const bundle = useApi<SubscriptionBundle>("/api/subscription");
  const keysApi = useApi<{ keys: KeyView[] }>("/api/keys");

  const rows = usage.data?.rows ?? [];
  const totals = usage.data?.totals;
  const pageCount = Math.max(1, Math.ceil((usage.data?.total ?? 0) / PAGE_SIZE));
  const filtered = range !== "30" || model !== "all" || keyId !== "all";

  /** Every filter writes the URL; one place owns the query string. */
  function setParam(name: string, value: string, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    if (value === "" || value === "all" || (name === "range" && value === "30")) {
      next.delete(name);
    } else {
      next.set(name, value);
    }
    if (resetPage) next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (usage.loading) return <PanelSkeleton rows={5} />;
  if (usage.error) return <ErrorState error={usage.error} onRetry={usage.reload} />;

  /**
   * The CSV link, built from the SAME parameters the table is using.
   *
   * An export that ignores the visible range and model produces a file
   * that disagrees with the screen — the worst kind of export bug, because
   * the user finds out after reconciling against it.
   *
   * A plain `<a download>` rather than a fetch: the browser owns the
   * download, the response is `Content-Disposition: attachment`, and
   * nothing has to buffer a large file in memory to hand it over.
   */
  const exportHref = `/api/usage/export${exportQuery ? `?${exportQuery}` : ""}`;

  return (
    <>
      <RefreshingBar show={usage.refreshing} />

      {bundle.data?.plan ? (
        <QuotaExhaustedBanner
          tokensByModel={bundle.data.tokensByModel ?? {}}
          tokenLimits={bundle.data.plan.tokenLimits ?? {}}
          entitled={bundle.data.plan.models ?? []}
          resetDate={bundle.data.subscription?.currentPeriodEnd ?? bundle.data.period.end}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Tokens"
          value={compact(totals?.blendedTokens ?? 0)}
          hint={`${compact(totals?.inputTokens ?? 0)} in · ${compact(totals?.outputTokens ?? 0)} out`}
          icon={Boxes}
        />
        <StatCard
          label="Requests"
          value={(totals?.requests ?? 0).toLocaleString()}
          hint={filtered ? "Matching these filters (incl. failures)" : "All gateway calls, incl. failures"}
          icon={Activity}
        />
        <StatCard
          label="Cached tokens"
          value={compact(totals?.cacheReadTokens ?? 0)}
          hint="Tokens served from cache (cheaper)"
          icon={Database}
        />
      </div>

      <UsageAreaChart
        points={series.data?.points ?? []}
        bucket={series.data?.bucket ?? "day"}
        rangeLabel={rangeLabel(series.data?.from, series.data?.to)}
        emptyNote={
          filtered
            ? "Nothing matched these filters in the selected window."
            : "Once your key makes its first call, the daily trend appears here."
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Gateway calls</CardTitle>
              <CardDescription>
                Every metered call, newest first — tokens are the only quota
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={range}
                onValueChange={(v) => setParam("range", v ?? "30")}
              >
                <SelectTrigger size="sm" className="w-32" aria-label="Date range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={model}
                onValueChange={(v) => setParam("model", v ?? "all")}
              >
                <SelectTrigger size="sm" className="w-28" aria-label="Model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All models</SelectItem>
                  {(bundle.data?.plan?.models ?? []).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(keysApi.data?.keys.length ?? 0) > 0 ? (
                <Select
                  value={keyId}
                  onValueChange={(v) => setParam("key", v ?? "all")}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label="API key">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All keys</SelectItem>
                    {(keysApi.data?.keys ?? []).map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {filtered ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    router.replace(pathname, { scroll: false })
                  }
                >
                  <X />
                  Clear
                </Button>
              ) : null}

              <Button
                variant="outline"
                size="icon-sm"
                onClick={usage.reload}
                aria-label="Refresh usage"
                disabled={usage.refreshing}
              >
                <RefreshCw className={usage.refreshing ? "animate-spin" : undefined} />
              </Button>

              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={exportHref} download />}
                title="Download these rows as CSV"
              >
                <Download />
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Tabs defaultValue="table">
            <div className="px-6">
              <TabsList>
                <TabsTrigger value="table">Table</TabsTrigger>
                <TabsTrigger value="models">By model</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="table" className="block w-full pt-4">
              {rows.length === 0 ? (
                filtered ? (
                  <NoResultsState
                    what="these filters"
                    onClear={() => router.replace(pathname, { scroll: false })}
                  />
                ) : (
                  <div className="px-6 py-16 text-center">
                    <p className="text-sm font-medium text-foreground">
                      No gateway calls yet
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Once your key makes its first call through the gateway, the
                      row lands here within a few minutes.
                    </p>
                  </div>
                )
              ) : (
                <Table className="table-fixed">
                  {/* Fixed column widths so the table always spans the full
                      card width with space distributed deliberately: the Key
                      column absorbs whatever is left, and numeric columns
                      stay compact and right-aligned instead of drifting. */}
                  {/* Percentages, not pixels: they always total 100% of the
                      container at any width, so the table can never
                      under-fill or overflow. Key takes the largest share
                      because it is the only variable-width text; the numeric
                      columns get enough room to sit right-aligned without
                      their headers colliding with the values. */}
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[26%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Time</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cache read</TableHead>
                      <TableHead className="pr-6 text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">
                          {dateTime(row.occurredAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{row.model}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.route === 'chat' ? 'Chat' : row.route === 'responses' ? 'Response' : row.route === 'messages' ? 'Messages' : row.route}
                        </TableCell>
                        <TableCell
                          className="max-w-0 truncate text-muted-foreground"
                          title={row.keyName ?? "deleted key"}
                        >
                          {row.keyName ?? <span className="text-xs">deleted key</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compact(
                            row.inputTokens +
                              row.outputTokens +
                              row.cacheWrite5mTokens +
                              row.cacheWrite1hTokens +
                              row.cacheReadTokens,
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.cacheReadTokens ? compact(row.cacheReadTokens) : "—"}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <StatusBadge code={row.statusCode} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {pageCount > 1 ? (
                <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
                  <span>
                    {(usage.data?.total ?? 0).toLocaleString()} row
                    {usage.data?.total === 1 ? "" : "s"} · page {page} of{" "}
                    {pageCount}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || usage.refreshing}
                      onClick={() => setParam("page", String(page - 1), false)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pageCount || usage.refreshing}
                      onClick={() => setParam("page", String(page + 1), false)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </TabsContent>

            {/* No horizontal padding: this panel's table spans the card
                edge-to-edge exactly like the Table tab. `px-6` here made it
                48px narrower than its sibling, so switching tabs visibly
                shifted the layout. */}
            <TabsContent value="models" className="pt-4">
              <ModelBreakdown
                rows={rows}
                hint={
                  pageCount > 1
                    ? `Counts this page only (${rows.length} of ${usage.data?.total}). Aggregates per model land with the CSV export.`
                    : undefined
                }
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * `status_code` is nullable by design — `statusCodeForRow` returns NULL
 * when LiteLLM reports a failure without naming a code. Rendering that as
 * "null" in a badge would look like a bug; the honest reading is
 * "failed, cause not reported".
 */
function StatusBadge({ code }: { code: number | null }) {
  if (code === null) {
    return (
      <Badge variant="outline" title="The gateway recorded a failure without a status code">
        failed
      </Badge>
    );
  }
  return (
    <Badge
      variant={code === 200 ? "secondary" : code === 429 ? "destructive" : "outline"}
    >
      {code}
    </Badge>
  );
}

function ModelBreakdown({
  rows,
  hint,
}: {
  rows: UsagePageResponse["rows"];
  hint?: string;
}) {
  const byModel = new Map<
    string,
    { requests: number; tokens: number; cache: number }
  >();
  for (const row of rows) {
    const entry = byModel.get(row.model) ?? {
      requests: 0,
      tokens: 0,
      cache: 0,
    };
    entry.requests += 1;
    entry.tokens +=
      row.inputTokens +
      row.outputTokens +
      row.cacheWrite5mTokens +
      row.cacheWrite1hTokens +
      row.cacheReadTokens;
    entry.cache += row.cacheReadTokens;
    byModel.set(row.model, entry);
  }

  if (byModel.size === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No usage to break down.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Table className="table-fixed">
        {/* Percentages summing to 100%, matching the requests table. Model
            holds an alias badge, so it gets the flexible share. */}
        <colgroup>
          <col className="w-[49%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cache read</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...byModel.entries()].map(([model, e]) => (
            <TableRow key={model}>
              <TableCell className="font-medium">{model}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {e.requests.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">{compact(e.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {compact(e.cache)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}