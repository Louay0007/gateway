"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Bubble — the person's words, and only theirs by default.
 *
 * `variant="muted"` is the person (a filled tint that reads as the raised
 * side of the conversation); `variant="ghost"` exists for the cases where a
 * short agent acknowledgement genuinely reads better boxed, but the default
 * for a reply is no bubble at all.
 */

export function Bubble({
  variant = "muted",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: "muted" | "ghost" | "outline" }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(
        "w-fit max-w-[95%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
        variant === "muted" && "bg-chat-bubble text-chat-bubble-foreground",
        variant === "ghost" && "bg-transparent px-0 py-0",
        variant === "outline" && "border border-border bg-background",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * BubbleContent — preserves the author's line breaks.
 *
 * `whitespace-pre-wrap` because a pasted stack trace is the most common
 * user message in a developer chat, and collapsing its newlines destroys
 * exactly the structure they pasted it for.
 *
 * `break-words`, NOT `overflow-wrap: anywhere`. This is the whole bug:
 * `anywhere` is the one value that ALSO changes a box's intrinsic
 * min-content width, so under the Bubble's `w-fit` the browser sized the
 * pill to the narrowest possible break — one character — and every message
 * wrapped its last letter onto a second line (`heee` / `y`). `break-word`
 * leaves intrinsic sizing alone and only breaks a token that would
 * otherwise overflow, which is what an unbreakable URL actually needs.
 */
export function BubbleContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words [word-break:normal]",
        className,
      )}
      {...props}
    />
  )
}
