"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Loader — the "working" indicator.
 *
 * A fade-and-rise rather than a bounce: overshoot easing reads as
 * impatience under a slow model, and the eye belongs on where the answer
 * will appear, not on the spinner. Deliberately CSS-only — an animation
 * that depends on hydration leaves a frozen dot if the stream dies.
 */
export function Loader({
  label = "Thinking",
  className,
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span
      data-slot="loader"
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center gap-1.5 py-1.5", className)}
      {...props}
    >
      <LoaderDot delay="0ms" />
      <LoaderDot delay="150ms" />
      <LoaderDot delay="300ms" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function LoaderDot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 rounded-full bg-muted-foreground/50"
      style={{
        animation: "chat-dot 1.15s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        animationDelay: delay,
      }}
    />
  )
}
