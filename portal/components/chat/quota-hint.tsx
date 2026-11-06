"use client";

import * as React from "react";
import Link from "next/link";

import type { ModelOption } from "@/components/chat/model-picker";
import { aliasMeta } from "@/components/chat/aliases";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { quotaPercent } from "@/lib/chat/quota";
import { cn } from "@/lib/utils";

/**
 * What THIS conversation has cost, summed over its assistant turns.
 *
 * Computed by the caller from the transcript rather than fetched: the
 * per-turn counts are already on every message the view holds, so a second
 * request would return numbers the page could already see.
 */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

/**
 * QuotaHint — the composer's budget meter, and the dialog behind it.
 *
 * THE METER STAYS A GLANCE. Five segments and a percentage, unchanged: it
 * sits beside the model picker in a footer that must not become a settings
 * panel.
 *
 * THE DIALOG IS WHERE THE QUESTION GETS ANSWERED. "How much have I spent"
 * splits into two facts that look alike and are not:
 *
 *   THIS CHAT     what the transcript recorded — input and output tokens on
 *                 each replayed turn.
 *   THIS PERIOD   what the budget counts — blended tokens across the alias,
 *                 including cache reads and writes, which the transcript
 *                 never sees.
 *
 * They are shown as two stacked readings, NOT as one bar with this chat as
 * a slice of the whole. The slice would be arithmetically wrong (the chat's
 * share of the period includes cache the transcript omits) and a user
 * reading a nearly-empty bar would conclude the chat cost nothing.
 *
 * Not `components/dashboard/quota-meter.tsx`: that one labels the bar with
 * the model name. The chat surface must never name the model behind an
 * alias, and a shared component with a `hideModelName` flag would put the
 * forbidden string one boolean away from the customer.
 */
export function QuotaHint({
  option,
  resetsAt,
  usage,
  className,
}: {
  option?: ModelOption;
  /** Pre-formatted window end (Tunis). Folds into the tooltip. */
  resetsAt?: string | null;
  /** This conversation's own tally. */
  usage?: ChatUsage;
  className?: string;
}) {
  if (!option) return null;

  const percent = quotaPercent(option.tokenLimit, option.remainingTokens);
  if (percent === null) return null; // No token budget on this plan.

  // Exhaustion is the remainder, not the rounded percent: 1 token left out
  // of 1000 rounds to 100% and would print "full" while the server still
  // accepts the request.
  const exhausted = (option.remainingTokens ?? 0) <= 0;
  const tone = exhausted || percent >= 95 ? "critical" : percent >= 80 ? "warn" : "calm";
  const label = aliasMeta(option.alias).label;

  const summary = exhausted
    ? `No ${label} tokens left in this window${resetsAt ? ` — resets ${resetsAt}` : ""}`
    : `${percent}% of this window's ${label} budget used${resetsAt ? ` — resets ${resetsAt}` : ""}`;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            // A number that changes every turn must not interrupt a screen
            // reader mid-sentence, so the live region stays off and the
            // button's own name carries the reading on demand.
            aria-label={`Token usage. ${summary}`}
            title="Tokens used"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] whitespace-nowrap",
              "text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              className,
            )}
          >
            <span className="flex items-center gap-[2px]" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                // Filled proportionally, so the meter reads at a glance
                // without a track line competing with the composer border.
                <span
                  key={i}
                  className={cn(
                    "block h-2.5 w-[3px] rounded-full transition-colors duration-300",
                    percent >= (i + 1) * 20
                      ? tone === "critical"
                        ? "bg-destructive"
                        : tone === "warn"
                          ? "bg-amber-500"
                          : "bg-foreground/50"
                      : "bg-foreground/15",
                  )}
                />
              ))}
            </span>
            <span className="tabular-nums">{exhausted ? "empty" : `${percent}%`}</span>
          </button>
        }
      />

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Tokens</DialogTitle>
        </DialogHeader>

        <div className="grid gap-1">
          <h3 className="text-[11px] font-medium text-muted-foreground/70">This chat</h3>
          {usage && usage.turns > 0 ? (
            <>
              <p className="text-2xl leading-tight font-medium tabular-nums">
                {formatTokens(usage.inputTokens + usage.outputTokens)}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out ·{" "}
                {formatUsd(usage.costUsd)}
              </p>
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Nothing answered yet. This chat's count appears after the first reply.
            </p>
          )}
        </div>

        <div className="h-px bg-(--chat-hairline)" role="presentation" />

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-medium text-muted-foreground/70">
              {label} this period
            </h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {exhausted ? "empty" : `${percent}%`}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${label} budget used: ${percent}%`}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                tone === "critical" ? "bg-destructive" : tone === "warn" ? "bg-amber-500" : "bg-foreground/50",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="flex items-baseline justify-between gap-3 text-[12px] text-muted-foreground">
            <span className="tabular-nums">
              {exhausted
                ? `Nothing left${resetsAt ? ` — resets ${resetsAt}` : ""}`
                : `${formatCompact(option.remainingTokens ?? 0)} left of ${formatCompact(option.tokenLimit ?? 0)}`}
            </span>
            {resetsAt && !exhausted ? (
              <span className="shrink-0 text-muted-foreground/70">resets {resetsAt}</span>
            ) : null}
          </p>
        </div>

        {/* Named rather than hidden: the period figure running above the
            transcript's own count looks like a bug until something says
            why. */}
        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          The period total includes cached reads and writes, so it runs higher than the count
          above.
        </p>

        <Link
          href="/settings?tab=plan"
          className="text-[12px] text-foreground/80 underline underline-offset-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Plan and full usage
        </Link>
      </DialogContent>
    </Dialog>
  );
}

/** 980 → "980", 12_480 → "12,480", 1_240_000 → "1.24M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Math.max(0, Math.round(n));
  if (v < 1_000) return String(v);
  if (v < 1_000_000) return v.toLocaleString("en-US");
  return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/**
 * Both sides of "620,000 left of 1M" go through this one, so the two
 * numbers never render on different scales.
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 0.01) return `${(value * 100).toFixed(2)}¢`;
  return `$${value.toFixed(2)}`;
}
