"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Suggestions — the horizontally scrolling pill row above the composer.
 *
 * This is AI Elements' `Suggestions` shape: one row, `w-max`, `flex-nowrap`,
 * scrollable on the x axis, sitting in the grid cell directly above the
 * prompt input. It replaces the previous 2×2 card grid, and the difference
 * is not cosmetic — a single row of short prompts reads as a strip of
 * examples you scan in one pass, where a card grid reads as navigation and
 * competes with the composer for attention.
 *
 * THE PILLS FILL, THEY DO NOT SEND. A click that spends a model call is a
 * guess billed to the user; the field is where they confirm.
 *
 * The scrollbar is hidden (the row fades at both edges instead) because a
 * visible horizontal bar under a chat composer looks like a defect. The
 * container stays keyboard-scrollable and every pill is a real button, so
 * nothing is lost to a screen reader or to Tab.
 */
const SUGGESTIONS = [
  "Explain this codebase to me",
  "Help me debug a failure",
  "Review my last change for bugs",
  "Plan how to implement a feature",
  "What are the trade-offs of this design?",
  "Write tests for this function",
];

export function Suggestions({
  onPick,
  className,
}: {
  onPick: (text: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-x-auto whitespace-nowrap",
        // Hide the bar in every engine; the row is short enough that the
        // cut-off pill is itself the affordance.
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <div className="flex w-max flex-nowrap items-center gap-2 px-4">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full border border-border bg-background px-4 py-1.5",
              "text-xs font-medium whitespace-nowrap transition-colors duration-150",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              "dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
