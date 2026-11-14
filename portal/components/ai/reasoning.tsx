"use client"

import * as React from "react"
import { cn } from "cn"
import { Brain, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button";

/**
 * Reasoning — the model's deliberation, collapsed and never merged into the
 * answer.
 *
 * OPENS WHILE STREAMING, FOLDS WHEN IT ENDS. While the model is thinking, a
 * spinner with nothing in it looks stalled, so the trace is open and the
 * header reads "Thinking…"; once the answer starts the panel collapses to
 * "Thought for a moment", because deliberation is context, not the reply.
 *
 * Folding is one-way after the turn ends (a user who opens it keeps it
 * open; a user who never opens it is never shown a wall of self-talk). The
 * text is `aria-expanded`-ed on the trigger so a screen reader gets the same
 * state the eye does.
 */
export function Reasoning({
  text,
  live = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  text: string
  /** True while the turn is still streaming. */
  live?: boolean
}) {
  const [open, setOpen] = React.useState(live)

  React.useEffect(() => {
    if (!live) setOpen(false)
  }, [live])

  if (!text) return null

  return (
    <div data-slot="reasoning" className={cn("mb-4 overflow-hidden", className)} {...props}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full justify-start px-1 py-1 text-left text-xs font-medium text-muted-foreground"
      >
        <Brain className={cn("size-3.5", live && "animate-pulse")} aria-hidden />
        <span className={cn(live && "thinking-shimmer")}>{live ? "Thinking…" : "Thought process"}</span>
        {live ? (
          <span aria-hidden className="thinking-dot inline-block size-1 rounded-full bg-foreground/70" />
        ) : null}
        <ChevronDown
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </Button>
      {open ? (
        <div
          className={cn(
            "chat-scroll mt-2 max-h-64 overflow-y-auto border-l-2 border-border pl-3",
            "text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground",
          )}
        >
          {text}
        </div>
      ) : null}
    </div>
  )
}
