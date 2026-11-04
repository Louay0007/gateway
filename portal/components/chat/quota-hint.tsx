"use client";

import type { ModelOption } from "@/components/chat/model-picker";
import { quotaPercent } from "@/lib/chat/quota";
import { cn } from "@/lib/utils";

/**
 * QuotaHint — the budget, kept to a narrow segment meter and a percentage.
 *
 * WHY IT SHRANK. It used to be a 14-wide track plus the sentence "0% of
 * smart used", sitting beside the model picker in the composer footer.
 * Three pieces of chrome in a row made the footer read as a settings panel,
 * and the two numbers a user actually wants — how much is left, and when it
 * resets — were split across two components.
 *
 * The full sentence still exists for anyone who needs it, in the `title` and
 * in the progressbar's own aria-label. The visible form is a five-segment
 * meter and a percentage: a glanceable status, not a readout.
 *
 * Not `components/dashboard/quota-meter.tsx`: that one labels the bar with
 * the model name. The chat surface must never name the model behind an
 * alias, and a shared component with a `hideModelName` flag would put the
 * forbidden string one boolean away from the customer.
 */
export function QuotaHint({
  option,
  resetsAt,
  className,
}: {
  option?: ModelOption;
  /** Pre-formatted window end (Tunis). Folds into the tooltip. */
  resetsAt?: string | null;
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

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-muted-foreground/80",
        className,
      )}
      // A number that changes every turn must not interrupt a screen reader
      // mid-sentence; the picker announces exhaustion on its own.
      aria-live="off"
      title={
        exhausted
          ? `No ${option.alias} tokens left in this window${resetsAt ? ` — resets ${resetsAt}` : ""}`
          : `${percent}% of this window's ${option.alias} budget used${resetsAt ? ` — resets ${resetsAt}` : ""}`
      }
    >
      <span
        className="flex items-center gap-[2px]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${option.alias} budget used: ${percent}%`}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          // Filled proportionally, so the meter reads at a glance without a
          // track line competing with the composer border.
          const on = percent >= (i + 1) * 20;
          return (
            <span
              key={i}
              className={cn(
                "block h-2.5 w-[3px] rounded-full transition-colors duration-300",
                on
                  ? tone === "critical"
                    ? "bg-destructive"
                    : tone === "warn"
                      ? "bg-amber-500"
                      : "bg-foreground/50"
                  : "bg-foreground/15",
              )}
            />
          );
        })}
      </span>
      <span className="tabular">{exhausted ? "empty" : `${percent}%`}</span>
    </div>
  );
}
