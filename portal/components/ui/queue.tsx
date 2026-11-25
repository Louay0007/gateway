"use client"

import * as React from "react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

/**
 * Queue — a capped, scrollable list of items waiting to be worked through.
 *
 * WHY IT EXISTS: the composer refuses a second send while a reply is still
 * streaming, so anything the user thinks of mid-answer was lost unless they
 * held it in their head. A queue makes the wait explicit: what you type lands
 * here, in order, and leaves as each slot frees up.
 *
 * The list is capped rather than free-growing. An uncapped queue pushes the
 * composer off the screen exactly when the user is typing into it.
 */
function Queue({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="queue"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-background px-3 pt-2 pb-2 shadow-xs",
        className,
      )}
      {...props}
    />
  )
}

function QueueList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      data-slot="queue-list"
      className={cn("mt-2 -mb-1", className)}
      {...props}
    >
      {/* 8rem fitted three rows of `py-1`; at the row height below it fits
          two and a half, which is the cue that the list scrolls. */}
      <div className="max-h-44 pr-4">
        <ul>{children}</ul>
      </div>
    </ScrollArea>
  )
}

function QueueItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="queue-item"
      className={cn(
        "group flex flex-col gap-1 rounded-md px-3 py-1.5 text-[14px] transition-colors hover:bg-muted",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The state dot: a hollow ring, because every row in this list is still
 * waiting. A sent message leaves the list rather than turning into a
 * struck-through row, so there is no second state to draw.
 */
function QueueItemIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="queue-item-indicator"
      className={cn(
        "mt-1 inline-block size-2.5 rounded-full border border-muted-foreground/50",
        className,
      )}
      {...props}
    />
  )
}

function QueueItemContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="queue-item-content"
      className={cn("line-clamp-1 grow break-words text-muted-foreground", className)}
      {...props}
    />
  )
}

function QueueItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="queue-item-actions"
      className={cn("flex gap-1", className)}
      {...props}
    />
  )
}

/**
 * A row action, invisible until the row is hovered or a child takes focus.
 *
 * `focus-visible:opacity-100` is not decoration: the row actions are the only
 * way to edit or drop a queued message, and a keyboard user cannot hover.
 * Without it they are unreachable.
 */
function QueueItemAction({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      data-slot="queue-item-action"
      className={cn(
        "size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
        className,
      )}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    />
  )
}

export {
  Queue,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  QueueItemActions,
  QueueItemAction,
}
