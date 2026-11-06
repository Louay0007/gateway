"use client"

import * as React from "react"
import { cn } from "cn"
import { ChevronDown, Globe } from "lucide-react"

/**
 * Sources — the pages a turn actually consulted.
 *
 * COLLAPSED BY DEFAULT, with the count in the trigger: a turn that searched
 * the web should say so without pushing the answer down the page. The links
 * carry `rel="noreferrer noopener"` and `target="_blank"`, because these are
 * third-party URLs entering the prompt — see lib/chat/web-search.ts for why
 * their text is treated as untrusted.
 *
 * The host is shown, not the full URL: an unbounded URL in a narrow column
 * wraps to four lines and tells the reader nothing the domain did not.
 */
export interface SourceItem {
  title: string
  url: string
  snippet?: string
}

export function Sources({
  sources,
  className,
  ...props
}: React.ComponentProps<"div"> & { sources: SourceItem[] }) {
  const [open, setOpen] = React.useState(false)

  if (!sources || sources.length === 0) return null

  return (
    <div data-slot="sources" className={cn("mb-4", className)} {...props}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1",
          "text-[11px] font-medium text-muted-foreground",
          "transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <Globe className="size-3" aria-hidden />
        <span>
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <ul className="mt-2 space-y-1.5">
          {sources.map((s, i) => (
            <li key={`${s.url}-${i}`}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg px-2 py-1.5",
                  "transition-colors hover:bg-accent/60",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="truncate">{s.title || hostOf(s.url)}</span>
                </span>
                <span className="truncate pl-[22px] text-[11px] text-muted-foreground">
                  {hostOf(s.url)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The domain, for a compact label. A malformed URL is returned as-is rather
 * than throwing: a bad link in a source list must not break the transcript.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}
