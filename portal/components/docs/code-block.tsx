"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * CodeBlock — a copyable snippet for the docs surface.
 *
 * Theme-agnostic: uses the code-surface tokens declared in globals.css
 * so it reads identically inside the light marketing canvas and the
 * themed dashboard shell. Copy falls back to select-all where
 * `navigator.clipboard` is unavailable (plain-HTTP LAN, insecure ctx).
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
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
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
      className={cn(
        "group/code overflow-hidden rounded-xl border border-border bg-background",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="flex gap-1.5"
          >
            <i className="size-2.5 rounded-full bg-muted" />
            <i className="size-2.5 rounded-full bg-muted" />
            <i className="size-2.5 rounded-full bg-muted" />
          </span>
          <span className="font-mono">
            {filename ?? language}
          </span>
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
          className="text-muted-foreground hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </figcaption>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-foreground">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </figure>
  );
}
