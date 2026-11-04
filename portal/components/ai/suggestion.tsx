"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Suggestion — one row of prompts, horizontally scrollable.
 *
 * A SINGLE ROW, not a card grid. A grid reads as navigation and competes
 * with the composer for attention; a row of short prompts reads as a strip
 * of examples scanned in one pass, which is what it is.
 *
 * THE PILLS FILL, THEY DO NOT SEND. A click that spends a model call is a
 * guess billed to the user; the field is where they confirm.
 *
 * The scrollbar is hidden and each edge is a real mask instead, because a
 * visible horizontal bar under a composer looks like a defect. Every pill
 * is a real button, so nothing is lost to Tab or to a screen reader.
 */
export function Suggestion({
  suggestions,
  onPick,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  suggestions: string[]
  onPick: (text: string) => void
}) {
  if (!suggestions.length) return null

  return (
    <div
      data-slot="suggestion"
      className={cn(
        "relative w-full overflow-x-auto whitespace-nowrap",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // A mask, not a fade overlay: it does not intercept clicks and it
        // follows the theme automatically.
        "[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]",
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex w-max max-w-3xl flex-nowrap items-center gap-2 px-4">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full border border-border bg-background px-3.5 py-1.5",
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
  )
}
