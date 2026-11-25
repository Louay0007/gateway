"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Message — one turn's alignment and shape.
 *
 * THE RULE THAT MATTERS: the person's turn is a filled, inset Bubble; the
 * agent's reply is NOT a bubble. An answer is a document — lists, headings,
 * tables, fenced code — and boxing it puts a border around every paragraph
 * and narrows it to less than the composer it was written in. This is the
 * single largest visual difference from a generic chat log, and it is why
 * `align="end"` and Bubble exist as separate components rather than one
 * component with a `role` prop that decides both.
 */

export function Message({
  align = "start",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message flex w-full flex-col",
        align === "end" ? "items-end" : "items-stretch",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="message-content" className={cn("min-w-0", className)} {...props}>
      {children}
    </div>
  )
}

/** The author's name/mark. Only used where a turn needs attribution. */
export function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", className)}
      {...props}
    />
  )
}

export function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn("mb-2 flex items-center gap-2 text-[13px] text-muted-foreground", className)}
      {...props}
    />
  )
}

/**
 * The per-turn toolbar under a reply: copy, regenerate, timing, cost.
 *
 * FADES IN ON HOVER, but is always focusable — `opacity` never hides it from
 * the keyboard, and `focus-within` reveals it, so Tab reaches the buttons
 * before they are visible. Hover-only visibility with `hidden` is the
 * classic way a chat ships actions a keyboard user cannot reach.
 */
export function MessageActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-actions"
      className={cn(
        // 12px, one step up from the 11px this shipped with: the toolbar is
        // the only place a turn reports its tokens and cost, and 11px made
        // those numbers feel like a footnote rather than a reading.
        "mt-2.5 flex flex-wrap items-center gap-3.5 text-[12px] text-muted-foreground",
        // 75%, not 60%. These are real numbers a reader may want (tokens,
        // cost, a truncation notice), and `muted-foreground` at 60% opacity
        // lands near 2.5:1 on the canvas. 75% keeps the row quiet at rest
        // and readable when it is actually being read.
        "opacity-75 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100",
        className,
      )}
      {...props}
    />
  )
}
