import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FirstUseState } from "@/components/dashboard/states";
import type { KeyView } from "@/lib/api/types";
import { relativeTime } from "@/lib/dashboard/format";

/**
 * OverviewKeysPanel — the overview's half of the "keys + activity" row.
 *
 * Reads the same `/api/keys` payload the keys page renders, so the two can
 * never disagree about how many keys exist or when one was last used.
 *
 * The first-use state is distinct from "no results": an account with zero
 * keys has not filtered anything out — it has not started — and the useful
 * response is the create action, not an apology for an empty list.
 */
export function OverviewKeysPanel({
  keys,
  planName,
  maxKeys,
  requestsThisPeriod,
}: {
  keys: KeyView[];
  planName: string;
  maxKeys: number;
  requestsThisPeriod: number;
}) {
  const usedPct = maxKeys > 0 ? Math.min(100, Math.round((keys.length / maxKeys) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              {keys.length} of {maxKeys} active on {planName}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard/keys" />}
          >
            Manage
            <ArrowUpRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Progress
          value={usedPct}
          aria-label={`Key slots used: ${usedPct}%`}
          className="[&_[data-slot=progress-track]]:h-1.5"
        />

        {keys.length === 0 ? (
          <FirstUseState
            title="No keys yet"
            body="Create one to start calling the gateway."
            action={
              <Button size="sm" nativeButton={false} render={<Link href="/dashboard/keys" />}>
                Create a key
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {key.keyPrefix}…
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(key.models ?? []).length > 0 ? (
                    <Badge variant="outline">{key.models!.join(", ")}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(key.lastUsedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          {requestsThisPeriod.toLocaleString()} requests this billing period
          across all keys.
        </p>
      </CardContent>
    </Card>
  );
}