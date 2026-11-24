"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, CircleCheck, CircleSlash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { daysRemainingAtRate, type QuotaTone } from "@/lib/dashboard/quota-tone";
import { statusCopy } from "@/lib/dashboard/status-copy";

/**
 * StatusStrip — the one sentence at the top of the Overview.
 *
 * WHY THIS IS THE MOST IMPORTANT COMPONENT ON THE PAGE. A customer opens
 * /dashboard to answer one question: "am I about to run out?" Before this
 * existed they had to read three stat cards and a bar and do the division
 * themselves, and the page gave 96%-used and 0%-used the same visual weight.
 * Here the answer is a sentence, a tone and one action.
 *
 * IT SUBSUMES `QuotaExhaustedBanner` rather than sitting beside it: the
 * blocked tone IS the exhausted state, with the same wording ("Out of
 * tokens for this period — resets <date>"), so the customer loses nothing
 * and never sees two competing warnings.
 *
 * EVERY NUMBER COMES FROM `SubscriptionBundle`, so the strip needs no
 * network of its own and renders from a fixture in a test. The one derived
 * figure — days at the current rate — comes from `quota-tone.ts`, the same
 * module the meter's colour reads.
 */

export interface StatusStripProps {
  /** Plan's shared allowance. Null/0 = unlimited. */
  poolTokens: number | null | undefined;
  poolUsedTokens: number;
  /** Subscription period start, for the burn-rate average. */
  periodStart?: string | null;
  /** Subscription period end — what "resets" means. */
  periodEnd?: string | null;
  /** True when the plan has no live subscription (paywall). */
  noPlan?: boolean;
  className?: string;
  /** Injectable clock, so a test can pin "days remaining". */
  now?: Date;
}

const TONE_STYLES: Record<QuotaTone, string> = {
  healthy: "border-border bg-card",
  watching: "border-warning/40 bg-warning/5",
  warning: "border-warning/60 bg-warning/10",
  blocked: "border-destructive/40 bg-destructive/5",
  unlimited: "border-border bg-card",
};

const TONE_TEXT: Record<QuotaTone, string> = {
  healthy: "text-muted-foreground",
  watching: "text-warning",
  warning: "text-warning",
  blocked: "text-destructive",
  unlimited: "text-muted-foreground",
};

const TONE_ICON: Record<QuotaTone, React.ComponentType<{ className?: string }>> = {
  healthy: CircleCheck,
  watching: CircleAlert,
  warning: CircleAlert,
  blocked: CircleSlash,
  unlimited: CircleCheck,
};

function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function StatusStrip({
  poolTokens,
  poolUsedTokens,
  periodStart,
  periodEnd,
  noPlan = false,
  className,
  now,
}: StatusStripProps) {
  const resets = longDate(periodEnd);
  const limit =
    typeof poolTokens === "number" && Number.isFinite(poolTokens) && poolTokens > 0
      ? poolTokens
      : null;
  const daysLeft =
    limit !== null
      ? daysRemainingAtRate(limit, poolUsedTokens, periodStart, now)
      : null;

  // All wording lives in `status-copy.ts` so every tone is unit-tested
  // without a DOM; this component only decides how it looks.
  const { tone, headline, detail, cta } = statusCopy({
    poolTokens,
    poolUsedTokens,
    resets,
    daysLeft,
    noPlan,
  });

  const Icon = TONE_ICON[tone];

  // `alert` only when the account is actually paused: an amber strip is
  // information, not an interruption.
  const live = tone === "blocked" ? "alert" : "status";

  return (
    <div
      role={live}
      aria-live={tone === "blocked" ? "assertive" : "polite"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3",
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-5 shrink-0", TONE_TEXT[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight">{headline}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      {cta ? (
        <Button
          size="sm"
          variant={tone === "blocked" || noPlan ? "default" : "outline"}
          nativeButton={false}
          render={<Link href={cta.href} />}
        >
          {cta.label}
          <ArrowUpRight />
        </Button>
      ) : null}
    </div>
  );
}
