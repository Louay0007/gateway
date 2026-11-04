"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Input Group — one bordered control with a body and a footer.
 *
 * THE SHAPE: the textarea grows inside the group, and the footer holds the
 * tools on the left and one submit on the right. The border lives on the
 * GROUP, never on the textarea, which is what makes it read as one control
 * instead of a text box with a row of buttons underneath it. That is the
 * whole reason these are separate parts rather than a styled `<textarea>`.
 */

export function InputGroup({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "group/input-group relative flex w-full flex-col rounded-xl border border-input bg-background",
        "shadow-xs transition-[color,box-shadow] duration-150",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
        "dark:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="input-group-textarea"
      className={cn(
        "field-sizing-content max-h-48 min-h-[52px] w-full resize-none",
        "rounded-none border-0 bg-transparent px-3.5 py-3",
        "text-base md:text-sm",
        "outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function InputGroupAddon({
  align = "start",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex items-center gap-1 px-2 pb-2",
        align === "start" ? "min-w-0 flex-wrap justify-start" : "justify-end",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function InputGroupButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="input-group-button"
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground",
        "transition-colors duration-150 hover:bg-accent hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
