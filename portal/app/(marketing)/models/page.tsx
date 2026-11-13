import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { ModelCard } from "@/components/models/model-card";
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
 * Competitors publish a card per model with price and live usage; we had
 * the data and showed it to nobody. The volume figure is read from
 * `usage_records`, so this page is measured rather than claimed, and it is
 * the only marketing page that changes on its own as the product is used.
 *
 * `force-dynamic`: the volume is a database read, so a prerendered page
 * would freeze a snapshot into the image.
 */
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const catalog = await buildCatalog();

  return (
    <>
      <SiteNav active="Models" />
      <main className="pt-16">
        <section className="border-b border-border bg-background py-14 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground">Models</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
              Four tiers. You never pick the engine.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              An alias is a promise about capability, not a vendor name. The
              engine behind it can change without you touching a line of code,
              which is why no model vendor appears anywhere on this page.
            </p>
          </div>
        </section>

        <section className="bg-background py-10 sm:py-14">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {catalog.map((m) => (
                <ModelCard key={m.alias} model={m} />
              ))}
            </div>

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Rates are per 1M blended tokens and are the list rates. Your
              plan&apos;s multiplier applies on top. Volume is measured over the
              last seven days across every customer — the same ledger the
              dashboard reads.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-background py-12">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Which models come with which plan
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Every plan includes one shared pool of tokens. The pool is
              spendable on any model the plan unlocks, in any proportion — not
              a separate allowance per model.
            </p>
            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Shared pool</th>
                    <th className="px-4 py-2.5 font-medium">Includes</th>
                  </tr>
                </thead>
                <tbody>
                  {POOL_PLANS.map((p) => (
                    <tr key={p.code} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium text-foreground">{p.label}</td>
                      <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">
                        {p.tokensLabel} / month
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[13px] text-muted-foreground">
                        {p.models.join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/playground"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Try a model in the playground
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
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
