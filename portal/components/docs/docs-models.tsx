"use client";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/docs/docs-section";
import { TIERS } from "@/components/docs/docs-data";
import { cn } from "@/lib/utils";

/**
 * Models — the four aliases, priced and positioned.
 *
 * ALIAS-ONLY by invariant: no upstream deployment name appears here.
 * Cards are glance-first: alias up top, price pair in the middle,
 * use-cases as chips, specs as a footer line. No icons — typography
 * and spacing carry the hierarchy.
 *
 * The plan list on each card comes from the same `TIERS[].plans` value the
 * /pricing page and the database agree on; a card that claims an alias is
 * Pro-only while Starter can call it is the exact contradiction that makes
 * a developer stop trusting the meter.
 */
export function ModelsSection() {
  return (
    <Section
      id="models"
      kicker="Models"
      title="Four names. That's the whole catalog."
      body={
        <>
          You never pick a deployment — you pick a tier and the gateway
          routes it. Swapping the models behind an alias is a deploy, not a
          migration, which is why no vendor model name appears anywhere in
          this catalog. Every plan gets one shared token pool spendable on
          any alias the plan includes.
        </>
      }
    >
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
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

              {/* No engine disclosure: the alias is the product, and
                  naming the model behind it would make an engine swap a
                  customer-visible change instead of a config edit. */}
              <p className="mt-3 text-xs font-medium text-foreground/80">
                Served on Zaino official infrastructure
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
        Rates are per 1M blended tokens, listed on the alias. Your plan's
        multiplier (Starter ×1.30, Pro ×1.25) applies on top. Cache reads are
        billed separately at the rate shown on each card. Failed requests are
        never billed.
      </p>
    </Section>
  );
}

