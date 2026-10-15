import { Check, Gauge, MessageSquareText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/docs/docs-section";
import { TIERS } from "@/components/docs/docs-data";
import { cn } from "@/lib/utils";

const TIER_ICON = {
  fast: Gauge,
  smart: MessageSquareText,
  frontier: Sparkles,
} as const;

/**
 * Models — the three aliases, priced and positioned.
 *
 * ALIAS-ONLY by invariant: no upstream deployment name appears here.
 * Cards are glance-first: speed tag + alias up top, one-line read
 * context, price pair, use-cases as chips, specs as a single footer
 * line. The "Most used" tier gets the emphasis border.
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
      <div className="grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => {
          const Icon = TIER_ICON[t.alias as keyof typeof TIER_ICON] ?? Gauge;
          const featured = t.alias === "smart";
          return (
            <article
              key={t.alias}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-5 transition-colors",
                featured
                  ? "border-2 border-foreground shadow-sm"
                  : "border-border hover:border-foreground/30",
              )}
            >
              {featured ? (
                <span className="absolute -top-3 left-5 rounded-full bg-foreground px-3 py-0.5 text-xs font-medium text-background">
                  Most used
                </span>
              ) : null}
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <code className="font-mono text-xl font-bold tracking-tight">
                    {t.alias}
                  </code>
                  <p className="truncate text-xs text-muted-foreground">
                    {SPEED_LINE[t.alias as keyof typeof SPEED_LINE]}
                  </p>
                </div>
                <Badge
                  variant={featured ? "default" : "outline"}
                  className="ml-auto shrink-0"
                >
                  {t.badge}
                </Badge>
              </div>

              <p className="mt-3 text-sm leading-relaxed">{t.tagline}</p>

              <dl className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    Read · in
                  </dt>
                  <dd className="text-lg font-bold tabular-nums">
                    {t.inputPerMtok}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      / Mtok
                    </span>
                  </dd>
                </div>
                <div className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    Write · out
                  </dt>
                  <dd className="text-lg font-bold tabular-nums">
                    {t.outputPerMtok}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      / Mtok
                    </span>
                  </dd>
                </div>
              </dl>

              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${t.alias} use cases`}>
                {t.bestFor.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    <Check className="size-3" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>

              <p className="mt-auto border-t border-border pt-3 text-xs text-muted-foreground">
                {t.plans} · 262k context · 32k max output
              </p>
            </article>
          );
        })}
      </div>
      <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Rates are nominal development figures so budgets stay exercisable —
        the provider publishes no pricing. They will be replaced with real
        numbers before customer money depends on them. Your plan&apos;s
        multiplier (Starter ×1.30, Pro ×1.25) applies on top.
      </p>
    </Section>
  );
}

const SPEED_LINE = {
  fast: "Fastest · bulk",
  smart: "Balanced · default",
  frontier: "Deepest · hardest tasks",
} as const;

