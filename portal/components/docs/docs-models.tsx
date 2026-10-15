import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/docs/docs-section";
import { TIERS } from "@/components/docs/docs-data";

/**
 * Models — the three aliases, priced and positioned.
 *
 * ALIAS-ONLY by invariant: no upstream deployment name appears here.
 * Each tier card carries nominal per-Mtok rates (mirroring
 * prices/models.yaml) so the page states the same numbers metering
 * charges — with the placeholder caveat where money is discussed.
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
        {TIERS.map((t) => (
          <article
            key={t.alias}
            className="flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/30"
          >
            <div className="flex items-center justify-between gap-2">
              <code className="rounded-md bg-muted px-2.5 py-1 font-mono text-lg font-semibold">
                {t.alias}
              </code>
              <Badge variant={t.alias === "smart" ? "default" : "outline"}>{t.badge}</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t.tagline}</p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-muted/60 px-3 py-2">
                <dt className="text-xs text-muted-foreground">Input / Mtok</dt>
                <dd className="font-semibold tabular-nums">{t.inputPerMtok}</dd>
              </div>
              <div className="rounded-lg bg-muted/60 px-3 py-2">
                <dt className="text-xs text-muted-foreground">Output / Mtok</dt>
                <dd className="font-semibold tabular-nums">{t.outputPerMtok}</dd>
              </div>
            </dl>
            <ul className="mt-4 grid gap-2 text-sm">
              {t.bestFor.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-4 text-xs text-muted-foreground">
              Plans: {t.plans} · 262k context · 32k max output
            </p>
          </article>
        ))}
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
