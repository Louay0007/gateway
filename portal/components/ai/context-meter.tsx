"use client";

import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTEXT_WINDOW } from "@/components/docs/docs-data";
import { cn } from "cn";

const grouped = new Intl.NumberFormat("en-US");

/**
 * ContextMeter — how much of the window this turn's prompt occupied.
 *
 * WHY IT ADDS TWO NUMBERS. `inputTokens` is FRESH input only, exclusive of
 * the cached prefix, because that is what the quota wall charges. OpenAI
 * caches a conversation's prefix automatically, so on a long chat the fresh
 * figure is a tiny fraction of what the model actually read: a measured
 * production turn reported 518 fresh tokens against a 297,807-token prompt.
 * A meter built on `inputTokens` alone would call that turn 0.05% of the
 * window when it was 28% — wrong by three orders of magnitude, and wrong
 * worst on exactly the long conversations where the reading matters.
 *
 * WHY IT IS NOT THE QUOTA METER. `QuotaHint` answers "what is left of my
 * plan", which is blended tokens across the period and includes cache
 * writes the transcript never sees. This answers "how much room is left in
 * this conversation", which is a per-turn fact. One bar for both would make
 * the plan look nearly empty and the chat look free.
 *
 * WHY THE WINDOW IS IMPORTED, NOT PASSED. Every alias in the catalog carries
 * the same `CONTEXT_WINDOW` (lib/models/catalog.ts), so a per-call-site
 * argument would be four chances to disagree with the docs page for no gain.
 */
export function ContextMeter({
  promptTokens,
  cachedTokens,
  className,
}: {
  /** FRESH input for this turn, as the transcript stores it. */
  promptTokens: number;
  /** The cached prefix of the same prompt. Absent when nothing was cached. */
  cachedTokens?: number | null;
  className?: string;
}) {
  const cached = cachedTokens && cachedTokens > 0 ? cachedTokens : 0;
  const prompt = promptTokens + cached;
  if (prompt <= 0) return null;

  // Clamped, not hidden: a prompt larger than the window is a real state
  // (the history cap can exceed it) and must read as full rather than as a
  // bar that overflows its track.
  const ratio = Math.min(1, prompt / CONTEXT_WINDOW);
  const pct = Math.round(ratio * 100);
  const tight = pct >= 85;
  const reading = `${grouped.format(prompt)} of ${grouped.format(CONTEXT_WINDOW)} tokens`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-slot="context-meter"
            // Focusable because the tooltip is the only place the numbers
            // are written out; a pointer-only reading would hide them from
            // the keyboard.
            tabIndex={0}
            aria-label={`Context: ${reading}`}
            className={cn(
              "inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <Progress value={pct} size="sm" className="w-10 shrink-0 sm:w-12" />
            <span className="tabular">{pct}%</span>
          </span>
        }
      />
      <TooltipContent className="max-w-64">
        <span className="block text-[11px] font-medium">{reading}</span>
        <span className="mt-1 block text-[11px] leading-snug opacity-80">
          This turn&rsquo;s prompt
          {cached > 0 ? `, ${grouped.format(cached)} of it read from cache` : ""}.
        </span>
        {tight ? (
          <span className="mt-1 block text-[11px] leading-snug opacity-80">
            The window is nearly full. Start a new chat to free it.
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
