"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * CodeBlock — a copyable snippet for the docs surface.
 *
 * WHAT CHANGED AND WHY. The old header carried three fake window chrome dots.
 * They meant nothing — this is not a window, it does not close or minimise, and
 * a reader never interacted with them — so they were decoration standing in a
 * slot where information belongs. The slot now says which FILE the snippet
 * belongs in (`request.sh`, `~/.codex/config.toml`) and what language it is,
 * which is the one question a copy-paste raises: where does this go?
 *
 * Theme-agnostic: uses the code-surface tokens declared in globals.css so it
 * reads identically inside the light marketing canvas and the themed dashboard
 * shell. Copy falls back to select-all where `navigator.clipboard` is
 * unavailable (plain-HTTP LAN, insecure context).
 */
export function CodeBlock({
  code,
  language,
  filename,
  className,
}: {
  code: string;
  language: string;
  filename?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const el = document.createElement("textarea");
        el.value = code;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <figure
      /* `min-w-0` IS LOAD-BEARING, and its absence pushed /docs 320px wide on
       * a 390px phone and /download 145px. A grid or flex child defaults to
       * `min-width: auto`, so it refuses to shrink below its widest content —
       * which for this block is the longest line inside <pre>. The `pre` did
       * have `overflow-x-auto`, but the scroll container was sized BY the
       * line, so it never engaged and the whole page scrolled instead.
       * `w-full` + `min-w-0` on the figure caps it at its container, and the
       * `pre` then scrolls its own content as intended. */
      className={cn(
        "group/code relative w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {filename ?? language}
          </span>
          {/* The language, when the filename did not already imply it. Kept
              lowercase and dim: it is a fact about the block, not a label for
              the reader. */}
          {filename ? (
            <span className="shrink-0 text-[0.625rem] tracking-[0.1em] text-muted-foreground uppercase">
              {language}
            </span>
          ) : null}
        </span>
        {/* The code surface is always dark, so this is one of the few places
            a ghost variant needs its own hover colour — the primitive carries
            focus, disabled and sizing; only the hover tint is local. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${language} snippet`}
          className="shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </figcaption>
      <pre className="min-w-0 overflow-x-auto p-4 text-[13px] leading-relaxed text-foreground">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
      {/* A right-edge fade: the one honest way to say "this scrolls" without
          spending a paragraph on it. It sits over the pre's padding and is
          pointer-transparent, so it never blocks a drag. A code block whose
          content overflows and shows no affordance reads as truncated — the
          quickstart credential block was doing exactly that at 380px wide. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent opacity-0 transition-opacity group-hover/code:opacity-100"
      />
    </figure>
  );
}
