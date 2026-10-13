import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { KeyView, UsageRowView } from "@/lib/api/types";
import { relativeTime } from "@/lib/dashboard/format";

/**
 * RecentActivity — the latest requests through the gateway.
 *
 * Built from the SAME `/api/usage` rows the Usage page tables, so the two
 * views cannot tell different stories about the same request. That is why
 * it takes rows rather than reading its own source.
 *
 * `keyName` is joined in by the endpoint. The previous version mapped
 * invented key ids through a hardcoded record, which would have rendered
 * "—" for every real row.
 */
export function RecentActivity({
  rows,
  keys,
}: {
  rows: UsageRowView[];
  keys: KeyView[];
}) {
  const nameFor = React.useMemo(() => {
    const map = new Map(keys.map((k) => [k.id, k.name] as const));
    return (apiKeyId: string | null) =>
      (apiKeyId && map.get(apiKeyId)) ?? null;
  }, [keys]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The latest requests through the gateway</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Your first request through the gateway will appear
            here.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {rows.map((row) => {
              const keyName = row.keyName ?? nameFor(row.apiKeyId);
              return (
                <li key={row.id} className="flex items-start gap-3">
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground">
                    {(keyName ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{keyName ?? "A deleted key"}</span>{" "}
                      <span className="text-muted-foreground">
                        {describe(row)}
                      </span>{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        {row.route}
                      </code>
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={statusVariant(row.statusCode)} className="h-5">
                        {row.statusCode ?? "failed"}
                      </Badge>
                      <span>{relativeTime(row.occurredAt)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** One sentence per row. Status drives the verb, so 429s read as themselves. */
function describe(row: UsageRowView): string {
  if (row.statusCode === 429) return "hit a limit on";
  if (row.statusCode !== null && row.statusCode >= 400) return "failed on";
  if (row.statusCode === null) return "failed (no status reported) on";
  return "completed a request on";
}

function statusVariant(
  status: number | null,
): "secondary" | "destructive" | "outline" {
  if (status === 200) return "secondary";
  // `null` means LiteLLM reported a failure without naming a code, which
  // is still a failure the customer should see as one.
  if (status === null || status >= 400) return "destructive";
  return "outline";
}