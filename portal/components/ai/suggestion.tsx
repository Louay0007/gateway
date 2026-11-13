"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Suggestion — the row of starter prompts above the composer.
 *
 * WRAPS INSTEAD OF SCROLLING. This used to be a single `flex-nowrap` row
 * inside `overflow-x-auto`, which meant every prompt past the viewport edge
 * was clipped mid-word with no visible affordance that more existed. A
 * starter prompt the reader cannot see is not a suggestion. Wrapping shows
 * all of them at once and costs one line of height on the empty state,
 * which is the one screen with height to spare.
 *
 * ALIGNED TO THE COMPOSER, not to the pane. The outer `px-4` and the inner
 * `mx-auto max-w-3xl` are the same pair `PromptInput` uses, so the first
 * pill sits on the composer's left edge at every width. Previously the
 * inner row was `w-max`, whose width is its content — so `mx-auto` centered
 * a box that was narrower than the composer and the two edges never lined
 * up.
 *
 * THE PILLS FILL, THEY DO NOT SEND. A click that spends a model call is a
 * guess billed to the user; the field is where they confirm.
 *
 * Every pill is a real button with a visible focus ring, and the group is
 * labelled, so the row is reachable by Tab and announced as one list. An
 * unusually long prompt wraps inside its own pill (`max-w-full`,
 * `whitespace-normal`) rather than overflowing the column.
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
    <div data-slot="suggestion" className={cn("w-full px-4", className)} {...props}>
      <div
        role="group"
        aria-label="Suggested prompts"
        className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2"
      >
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            title={s}
            className={cn(
              "max-w-full shrink-0 cursor-pointer rounded-full border border-border bg-background px-3.5 py-1.5",
              "text-left text-xs font-medium whitespace-normal transition-colors duration-150",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              " dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
