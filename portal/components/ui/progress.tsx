"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "cn"

/**
 * `size` exists because the track's height is a plain `h-1` in this file, and
 * a caller's `className` lands on the ROOT — so no utility on the root can
 * beat it (measured: an inline `[&_[data-slot=progress-track]]:h-1.5` on the
 * root still rendered a 1px track). Naming the size here is the only way a
 * compact bar in a table row gets a visible height without a specific
 * descendant hack at every call site.
 */
function Progress({
  className,
  children,
  value,
  size = "default",
  ...props
}: ProgressPrimitive.Root.Props & { size?: "default" | "sm" | "lg" }) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack size={size}>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({
  className,
  size = "default",
  ...props
}: ProgressPrimitive.Track.Props & { size?: "default" | "sm" | "lg" }) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex w-full items-center overflow-x-hidden rounded-full bg-muted",
        // 1px reads as a hairline at card width and as nothing at 80px, so a
        // compact bar in a table needs its own step rather than the default.
        size === "sm" ? "h-1.5" : size === "lg" ? "h-2.5" : "h-1",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full bg-primary transition-all", className)}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-sm text-muted-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
