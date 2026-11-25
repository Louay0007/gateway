"use client"

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "cn"

/**
 * A scroll container with a thin overlay scrollbar that only shows while the
 * pointer is over it or the user is scrolling.
 *
 * WHY NOT `overflow-y-auto`: the native scrollbar in this app is styled per
 * platform and takes a lane of its own, which shifts content sideways the
 * moment a list grows past its cap. This keeps the lane reserved and drawn
 * on top, so a queue that gains an item does not reflow the message above it.
 */
function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        orientation="vertical"
        className="flex w-2 touch-none select-none p-px opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
      >
        <ScrollAreaPrimitive.Thumb
          data-slot="scroll-area-thumb"
          className="w-full rounded-full bg-border"
        />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollArea }
