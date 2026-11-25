"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { hostOf, type SourceItem } from "@/components/ai/sources"

/**
 * The body of a citation tooltip: what the page is, where it lives, and the
 * line the model actually leaned on.
 *
 * Shared so a numbered `[1]` marker and an ordinary source link in the prose
 * show the same thing. Two copies would drift, and the drift would be
 * invisible — one would quietly stop showing the snippet.
 */
export function CitationTooltipContent({ source }: { source: SourceItem }) {
  return (
    <>
      <span className="block text-[11px] font-medium">{source.title || hostOf(source.url)}</span>
      <span className="mt-0.5 block text-[11px] opacity-70">{hostOf(source.url)}</span>
      {source.snippet ? (
        <span className="mt-1 block line-clamp-3 text-[11px] leading-snug opacity-80">
          {source.snippet}
        </span>
      ) : null}
    </>
  )
}

/**
 * InlineCitation — the numbered marker that ties a sentence to a source.
 *
 * WHY A MARKER AND NOT A REPLACEMENT FOR THE LINK: the model is asked to
 * cite the source URL, and it writes that URL as ordinary link text inside
 * its own sentence. Swapping that for a bare `[1]` would delete words the
 * reader is mid-way through. So the marker is appended beside the anchor,
 * carrying the same number the Sources list gives that page.
 *
 * WHY AN ANCHOR AND NOT A BUTTON: `TooltipTrigger` renders a button element
 * by default, and a marker that cannot be opened in a new tab is a dead end
 * when the tooltip is not enough. `render` swaps the element; Base UI only
 * injects `type="button"` for its own default tag, so nothing invalid
 * reaches the DOM.
 *
 * Keyboard-reachable: the trigger is a link, so Tab lands on it and the
 * tooltip opens on focus rather than on hover alone.
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
        <CitationTooltipContent source={source} />
      </TooltipContent>
    </Tooltip>
  )
}
