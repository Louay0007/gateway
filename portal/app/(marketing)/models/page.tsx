import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { ModelCard } from "@/components/models/model-card";
import { formatTokens } from "@/lib/models/format";
import { buildCatalog } from "@/lib/models/catalog";
import { POOL_PLANS } from "@/components/docs/docs-data";

export const metadata: Metadata = {
  title: "Models | Zaino AI",
  description:
    "Four tiers — fast, smart, frontier, fable — with per-million token rates and the volume each actually served in the last seven days.",
};

/**
 * /models — the catalog.
 *
 * Competitors publish a card per model with price and live usage; we had the
 * data and showed it to nobody. The volume figure is read from
 * `usage_records`, so this page is measured rather than claimed, and it is the
 * only marketing page that changes on its own as the product is used.
 *
 * STRUCTURE. Three registers, not three identical panels:
 *
 *   1. A header that states the one idea the page exists for — an alias is a
 *      promise about capability, not a vendor name — at a readable measure.
 *   2. The catalog: four cards, and above them a single line of total volume
 *      so the reader knows the numbers are live before reading any of them.
 *   3. The plan matrix, which answers the question the cards raise ("which of
 *      these can I actually call?") as a table rather than as more cards.
 *
 * `force-dynamic`: the volume is a database read, so a prerendered page would
 * freeze a snapshot into the image.
 */
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const catalog = await buildCatalog();

  // Total measured volume across tiers. Shown once, above the grid, because a
  // reader who sees one large honest number believes the four small ones.
  const totalServed = catalog.reduce((sum, m) => sum + (m.servedLast7d ?? 0), 0);

  return (
    <>
      <SiteNav active="Models" />
      <main className="pt-16">
        <header className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Models
            </p>
            <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl">
              Four tiers. You never pick the engine.
            </h1>
            <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-muted-foreground">
              An alias is a promise about capability, not a vendor name. The
              engine behind it can change without you touching a line of code,
              which is why no model vendor appears anywhere on this page.
            </p>

            {totalServed > 0 ? (
              <p className="mt-8 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {formatTokens(totalServed)}
                </span>
                tokens served across all four tiers in the last seven days.
                Measured from the same ledger your dashboard reads.
              </p>
            ) : null}
          </div>
        </header>

        <section className="bg-background py-14 sm:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {catalog.map((m, i) => (
                <ModelCard key={m.alias} model={m} index={i} />
              ))}
            </div>

            <p className="mt-6 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
              Rates are per 1M blended tokens and are the list rates. Your
              plan&apos;s multiplier applies on top. Volume is measured over the
              last seven days across every customer — the same ledger the
              dashboard reads.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-14 sm:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-[62ch]">
              <h2 className="text-balance text-xl font-semibold tracking-tight text-foreground">
                Which tiers come with which plan
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Every plan includes one shared pool of tokens. The pool is
                spendable on any tier the plan unlocks, in any proportion — not
                a separate allowance per tier.
              </p>
            </div>

            {/* A matrix, not a list. The reader's question is "can I call
                frontier on the plan I am considering", which is a row-by-
                column answer; the previous three-column list made them
                cross-reference two rows by eye. */}
            <div className="mt-7 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Plan
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      Shared pool
                    </th>
                    {["fast", "smart", "frontier", "fable"].map((alias) => (
                      <th
                        key={alias}
                        scope="col"
                        className="px-4 py-2.5 text-center"
                      >
                        <code className="font-mono text-[13px] font-medium text-foreground">
                          {alias}
                        </code>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {POOL_PLANS.map((p) => (
                    <tr
                      key={p.code}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <th
                        scope="row"
                        className="px-4 py-2.5 text-left text-[13px] font-medium text-foreground"
                      >
                        {p.label}
                      </th>
                      <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums text-muted-foreground">
                        {p.tokensLabel} / mo
                      </td>
                      {["fast", "smart", "frontier", "fable"].map((alias) => {
                        const included = p.models.includes(alias);
                        return (
                          <td key={alias} className="px-4 py-2.5 text-center">
                            {included ? (
                              <span
                                className="font-mono text-[13px] text-foreground"
                                aria-label="included"
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                className="text-muted-foreground/40"
                                aria-label="not included"
                              >
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <Link
                href="/playground"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 font-medium text-background transition-opacity hover:opacity-90"
              >
                Try a tier in the playground
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-10 items-center rounded-xl border border-border px-4 font-medium text-foreground transition-colors hover:bg-background"
              >
                See pricing
              </Link>
            </div>
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
