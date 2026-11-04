"use client"

import * as React from "react"
import { cn } from "cn"
import { Check, Copy } from "lucide-react"

/**
 * Code Block — a fenced block with a language label and a copy button.
 *
 * COPY IS OFF UNTIL THE FENCE CLOSES. While a reply streams, the code under
 * the cursor is half a function; a copy button that hands the user an
 * unterminated block and reports success is worse than no button. So
 * `complete={false}` renders the label but not the action.
 */

export function CodeBlock({
  code,
  language,
  complete = true,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  code: string
  language?: string
  /** False while the fence is still streaming. Hides copy. */
  complete?: boolean
}) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div
      data-slot="code-block"
      className={cn(
        "group/code relative my-3 overflow-hidden rounded-lg border border-border/60 bg-chat-code-bg",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
          {language || "code"}
        </span>
        {complete && code ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(code)
                .then(() => setCopied(true))
                .catch(() => {})
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground",
              "transition-colors hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            )}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}
