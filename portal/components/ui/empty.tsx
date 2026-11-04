"use client"

import * as React from "react"
import { cn } from "cn"

/** Empty — a centred, generously-padded empty state for a surface with nothing in it yet. */
export function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center", className)}
      {...props}
    />
  )
}

export function EmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-media"
      className={cn("flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground", className)}
      {...props}
    />
  )
}

export function EmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="empty-title" className={cn("text-sm font-medium", className)} {...props} />
}

export function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("max-w-[46ch] text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}
