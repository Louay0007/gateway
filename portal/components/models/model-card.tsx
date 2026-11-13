"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CatalogModel } from "@/lib/models/catalog";

/**
 * ModelCard — one alias, priced and measured.
 *
 * The card carries the two things a developer needs to decide: what it
 * costs, and whether anyone actually uses it. The volume figure is a real
 * measurement over the last seven days, so it is the one number on this
 * page that cannot be a marketing claim.
 *
 * Copy-slug is a one-click `fast` / `smart` / … because the most common
 * failure at this stage is a typo in the model field, which the gateway
 * answers with a 403 that reads like a plan problem.
 */
export function ModelCard({ model }: { model: CatalogModel }) {
  const [copied, setCopied] = React.useState(false);

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
    <article className="flex flex-col rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <code className="font-mono text-xl font-semibold tracking-tight text-foreground">
              {model.alias}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void copyAlias()}
              aria-label={`Copy the ${model.alias} alias`}
              className="text-muted-foreground"
            >
              {copied ? (
                <Check aria-hidden />
              ) : (
                <Copy aria-hidden />
              )}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{model.tagline}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground",
          )}
        >
          {model.plans}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-2">
        <Price label="Input" value={model.inputPerMtok} />
        <Price label="Output" value={model.outputPerMtok} />
        <Price label="Cache read" value={model.cacheReadPerMtok} />
      </dl>

      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={`${model.alias} use cases`}>
        {model.bestFor.map((b) => (
          <li
            key={b}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            {b}
          </li>
        ))}
      </ul>

      <div className="mt-auto grid gap-1 border-t border-border pt-4 text-[11px] text-muted-foreground">
        <span>
          {formatContext(model.contextWindow)} context ·{" "}
          {formatContext(model.maxOutputTokens)} max output
        </span>
        <span className="tabular-nums">
          {model.servedLast7d == null
            ? "Volume unavailable"
            : `${formatTokens(model.servedLast7d)} tokens served in the last 7 days`}
        </span>
      </div>
    </article>
  );
}

function Price({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-2.5 py-2">
      <dt className="text-[10px] tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
      <dd className="text-[10px] text-muted-foreground">per 1M</dd>
    </div>
  );
}

/** 1048576 → "1M" */
export function formatContext(n: number): string {
  if (n >= 1_048_576) return "1M";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Raw token count → a short human figure. 0 stays "0". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}
