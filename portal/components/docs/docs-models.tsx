"use client";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/docs/docs-section";
import { TIERS } from "@/components/docs/docs-data";
import { cn } from "@/lib/utils";

/**
 * Models — the three aliases, priced and positioned.
 *
 * ALIAS-ONLY by invariant: no upstream deployment name appears here.
 * Cards are glance-first: alias up top, price pair in the middle,
 * use-cases as chips, specs as a footer line. No icons — typography
 * and spacing carry the hierarchy.
 */
export function ModelsSection() {
  return (
    <Section
      id="models"
      kicker="Models"
      title="Three names. That's the whole catalog."
      body={
        <>
          You never pick a deployment — you pick a tier and the gateway
          load-balances across several models behind it, skipping a
          rate-limited pool instead of failing your request. Swapping the
          models behind an alias is a deploy, not a migration.
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => {
          const featured = t.alias === "smart";
          return (
            <article
              key={t.alias}
              className={cn(
                "flex flex-col rounded-3xl border bg-card p-8 transition-colors hover:border-foreground/20",
                featured
                  ? "border-2 border-foreground shadow-sm ring-1 ring-foreground/10"
                  : "border-border",
              )}
            >
              {featured ? (
                <span className="inline-flex items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background uppercase tracking-wider">
                  Most used
                </span>
              ) : null}
              <div className="mt-6 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <code className="font-mono text-xl font-bold tracking-tight">
                    {t.alias}
                  </code>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.bestFor[0]}
                  </p>
                </div>
                <Badge variant={featured ? "default" : "outline"} className="shrink-0">
                  {t.badge}
                </Badge>
              </div>

              <p className="mt-3 text-xs font-medium text-foreground/80">
                Served on Zaino official infrastructure · {t.poweredBy}
              </p>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t.tagline}
              </p>

              <dl className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-muted px-3 py-3">
                  <dt className="text-[10px] tracking-widest text-muted-foreground uppercase font-semibold">
                    Input
                  </dt>
                  <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {t.inputPerMtok}
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-muted-foreground">
                    per 1M tokens
                  </dd>
                </div>
                <div className="rounded-2xl bg-muted px-3 py-3">
                  <dt className="text-[10px] tracking-widest text-muted-foreground uppercase font-semibold">
                    Output
                  </dt>
                  <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {t.outputPerMtok}
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-muted-foreground">
                    per 1M tokens
                  </dd>
                </div>
                <div className="rounded-2xl bg-muted px-3 py-3">
                  <dt className="text-[10px] tracking-widest text-muted-foreground uppercase font-semibold">
                    Cache Read
                  </dt>
                  <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {t.cacheReadPerMtok}
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-muted-foreground">
                    per 1M tokens
                  </dd>
                </div>
              </dl>

              <ul className="mt-6 flex flex-wrap gap-2" aria-label={`${t.alias} use cases`}>
                {t.bestFor.map((b) => (
                  <li
                    key={b}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    {b}
                  </li>
                ))}
              </ul>

              <p className="mt-auto pt-6 border-t border-border text-xs text-muted-foreground">
                {t.plans} · 1M context · 64k max output
              </p>
            </article>
          );
        })}
      </div>
      <p className="mt-8 rounded-xl border border-border bg-muted/40 px-4 py-4 text-xs leading-relaxed text-muted-foreground">
        Pricing reflects Zaino's official rates for Haiku 5.5, Sonnet 5.5,
        and Opus 5.5. Your plan's multiplier (Starter ×1.30, Pro ×1.25)
        applies on top. Cache reads are billed separately at the rates
        shown above.
      </p>
    </Section>
  );
}

