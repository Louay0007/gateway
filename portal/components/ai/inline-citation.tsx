"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { hostOf, type SourceItem } from "@/components/ai/sources"

/**
 * Inline Citation — the `[1]` superscript in a reply, with its source on
 * hover and as a real link.
 *
 * WHY THIS EXISTS SEPARATELY FROM Sources: a claim deep in a paragraph
 * should be checkable where it is made. The list at the top of the turn
 * answers "what did it read"; this answers "where did THIS sentence come
 * from".
 *
 * Keyboard-reachable: the trigger is a link, so Tab lands on it and the
 * tooltip opens on focus (not hover only), which is the difference between
 * a citation and a decoration.
 */
export function InlineCitation({
  index,
  source,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  /** 1-based number as it appears in the text. */
  index: number
  source: SourceItem
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            data-slot="inline-citation"
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Source ${index}: ${source.title || hostOf(source.url)}`}
            className={cn(
              "mx-0.5 inline-flex h-[1.15em] min-w-[1.15em] items-center justify-center align-super",
              "rounded-[0.3em] bg-muted px-[0.3em] text-[0.65em] leading-none font-medium",
              "text-muted-foreground no-underline transition-colors",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              className,
            )}
            {...props}
          >
            {index}
          </a>
        }
      />
      <TooltipContent className="max-w-64">
        <span className="block text-[11px] font-medium">{source.title || hostOf(source.url)}</span>
        <span className="mt-0.5 block text-[11px] opacity-70">{hostOf(source.url)}</span>
        {source.snippet ? (
          <span className="mt-1 block line-clamp-3 text-[11px] leading-snug opacity-80">
            {source.snippet}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
