import * as React from "react";
import { RefreshCw, TriangleAlert, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/use-api";

/**
 * The states every live panel needs.
 *
 * This exists because the Iron Law — no component is done until its empty,
 * loading, error and partial states exist — is what wiring real data
 * turned from a slogan into four components. Mock data has exactly one
 * state, so a mock-only UI looks finished and a live one collapses on
 * contact with an account that has spent nothing.
 *
 * The three empties are genuinely different and are NOT collapsed:
 * first-use ("you have none yet — do this"), no-results ("nothing matched
 * — clear the filter"), and cleared ("nothing needs you"). Copy that
 * treats them as one is the most common shortcut in generated UI.
 */

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="grid gap-3 rounded-xl border border-border bg-card p-6"
    >
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * A failure the user can act on.
 *
 * Copy follows what/why/what-now, and never exposes a status code. A
 * non-recoverable error offers the nearest useful destination instead of
 * a Retry button that would fail identically.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: ApiError;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`grid gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center ${className ?? ""}`}
    >
      <TriangleAlert className="mx-auto size-5 text-destructive" aria-hidden />
      <div>
        <p className="text-sm font-medium text-foreground">
          We couldn&apos;t load this
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {error.message}
        </p>
      </div>
      {error.recoverable && onRetry ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** First use: explain the feature and give the one action that starts it. */
export function FirstUseState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="flex justify-center pt-1">{action}</div> : null}
    </div>
  );
}

/** No results: echo what was searched, and offer to clear it. */
export function NoResultsState({
  what,
  onClear,
}: {
  what: string;
  onClear?: () => void;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Nothing matches {what}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Try a wider date range, or clear the filters to see everything.
      </p>
      {onClear ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The paywall.
 *
 * `no_subscription` is a normal state, not an error: a brand-new account
 * owns an org and a team and has no plan yet (lib/billing). Rendering that
 * as "no usage this period" would be a lie — the key creation endpoint is
 * answering `payment_required`, so the reason has to be stated and the
 * route out has to be on this page.
 */
export function PaywallState({ cta }: { cta?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 px-6 py-10 text-center">
      <Wallet className="mx-auto size-5 text-primary" aria-hidden />
      <div>
        <p className="text-sm font-medium text-foreground">
          Choose a plan to unlock your keys
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          This account has no active subscription, so the gateway refuses key
          creation with <code className="rounded bg-muted px-1 font-mono text-xs">payment_required</code>.
        </p>
      </div>
      {cta ? <div className="flex justify-center pt-1">{cta}</div> : null}
    </div>
  );
}

/** A 15px spinner row for "refreshing, data still on screen". */
export function RefreshingBar({ show }: { show: boolean }) {
  return (
    <div
      aria-live="polite"
      className={`flex h-4 items-center justify-end text-xs text-muted-transition ${show ? "" : "invisible"}`}
    >
      {show ? "Updating…" : " "}
    </div>
  );
}