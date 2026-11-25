"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatContext, formatTokens } from "@/lib/models/format";
import type { CatalogModel } from "@/lib/models/catalog";

/**
 * ModelCard — one alias, priced and measured.
 *
 * WHAT CHANGED AND WHY. The first version stacked three equal `bg-muted`
 * price tiles at the top of every card, so the eye landed on nine identical
 * grey boxes before it reached the alias — and four cards in a 1280px
 * container measured 289px each, which is not enough for a three-across
 * price row to stay legible. The card now leads with the alias (the thing
 * you type), puts the input rate beside it as the headline figure, and
 * demotes output/cache to one reference line. The measured volume is the
 * only line with a rule above it, because it is the only claim on the card
 * that a competitor cannot copy.
 *
 * ALIAS-ONLY (invariant): no upstream deployment name appears anywhere.
 *
 * Copy-slug is one click because the most common failure at this stage is a
 * typo in the model field, which the gateway answers with a 403 that reads
 * like a plan problem.
 */
export function ModelCard({
  model,
  index = 0,
}: {
  model: CatalogModel;
  /** Position in the ladder; drives the restrained emphasis on the default. */
  index?: number;
}) {
  const [copied, setCopied] = React.useState(false);
  const isDefault = model.alias === "smart";

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyAlias() {
    try {
      await navigator.clipboard.writeText(model.alias);
      setCopied(true);
    } catch {
      // Clipboard is unavailable on insecure origins; the alias is visible
      // and selectable, so this is a convenience, not a requirement.
    }
  }

  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col rounded-2xl border p-5 transition-colors",
        isDefault
          ? "border-foreground/25 bg-card"
          : "border-border bg-card hover:border-foreground/20",
      )}
    >
      {/* The alias NEVER truncates; the plan pill does.

          At four-across on a 1440px container each card is ~290px, and the
          `plans` string on frontier and fable is "Pro · Team · Business" —
          long enough that `truncate` on the alias (the previous layout) turned
          the two most expensive tiers into "fro…" and "fab…". The alias is the
          literal a customer types, so it keeps its full width and the pill
          gives way: full label on wide cards, plan COUNT on narrow ones. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <code className="font-mono text-lg font-semibold tracking-tight text-foreground">
            {model.alias}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => void copyAlias()}
            aria-label={copied ? "Copied" : `Copy the ${model.alias} alias`}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </Button>
        </div>
        <span
          className="min-w-0 truncate rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
          title={model.plans}
        >
          {model.plans}
        </span>
      </div>

      <p className="mt-1.5 min-h-[2.25rem] text-[13px] leading-relaxed text-muted-foreground">
        {model.tagline}
      </p>

      {/* The one figure that leads. Input is what a request costs before it
          answers, so it is the number a buyer compares first. */}
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums text-foreground">
          {model.inputPerMtok}
        </span>
        <span className="text-[11px] text-muted-foreground">/ 1M in</span>
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Output</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {model.outputPerMtok}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Cache</dt>
          <dd className="font-mono tabular-nums text-muted-foreground">
            {model.cacheReadPerMtok}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={`${model.alias} use cases`}>
        {model.bestFor.map((b) => (
          <li
            key={b}
            className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {b}
          </li>
        ))}
      </ul>

      {/* Measured, so it gets the rule above it and the only bold value in
          the footer. A number nobody can copy is the point of the card. */}
      <div className="mt-auto grid gap-1 border-t border-border pt-3 text-[11px]">
        <span className="text-muted-foreground">
          {formatContext(model.contextWindow)} context ·{" "}
          {formatContext(model.maxOutputTokens)} out
        </span>
        <span className="tabular-nums text-muted-foreground">
          {model.servedLast7d == null ? (
            "Volume unavailable"
          ) : (
            <>
              <span className="font-medium text-foreground">
                {formatTokens(model.servedLast7d)}
              </span>{" "}
              tokens served · 7 days
            </>
          )}
        </span>
      </div>
    </article>
  );
}
