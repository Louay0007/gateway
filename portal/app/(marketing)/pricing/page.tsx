import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { PricingFaq } from "@/components/marketing/pricing-faq";
import { PricingProof } from "@/components/marketing/pricing-proof";
import { currentUser } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Pricing Plans",
  description:
    "Monthly plans with one shared token pool, priced in US dollars or Tunisian dinars. No per-model ceiling, failed requests never billed.",
  alternates: { canonical: "/pricing" },
};

/**
 * /pricing — the last screen before someone pays.
 *
 * THE OLD SHAPE, AND WHY IT WAS REPLACED. It was four stack-panels of
 * identical weight: a centred header block, a five-across card row, a table,
 * a rate table, an FAQ, a CTA. Measured on a 1440px viewport, the cards got
 * 176px each — narrow enough that every plan description wrapped to two words
 * a line — and all four sections carried the same 64px padding, so nothing on
 * the page outranked anything else.
 *
 * WHAT CHANGED
 *
 *   - The header is now the only full-width band and carries the one fact a
 *     buyer needs before scrolling: the ladder is priced in dinars, and the
 *     dollar figure is a reference. Its lede is set to a 65–75ch measure
 *     instead of a 672px column that ran three lines.
 *   - Cards live in two audience bands (see pricing-plans.tsx), so each row
 *     is a whole row and each card gets real width.
 *   - The proof strip sits between the price and the table, because that is
 *     the moment a buyer starts doubting: it answers "is this real" with the
 *     facts that are checkable rather than with adjectives.
 *   - Spacing now varies by role (header 20/24, ladder 20, proof 16, FAQ 16,
 *     closing 12) instead of one repeated value.
 *
 * `force-dynamic`: `currentUser()` decides whether the CTA says "Start with
 * Starter" or "Switch to Starter", and a prerendered variant would show the
 * signed-out copy to a signed-in customer.
 */
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await currentUser();

  return (
    <>
      <SiteNav active="Pricing" />
      <main className="pt-16">
        <header className="relative overflow-hidden border-b border-border bg-background">
          {/* A single horizon arc, reused from the landing page's vocabulary
              but quieted: at 12% it reads as light on the page edge, not as a
              second hero. Decorative only. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 h-80 opacity-[0.12]"
            style={{
              background:
                "radial-gradient(ellipse 60% 100% at 50% 100%, var(--foreground) 0%, transparent 70%)",
            }}
          />
          <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Pricing
            </p>
            <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl">
              Pay monthly, in dinars or dollars.
            </h1>
            <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-muted-foreground">
              One shared token pool per plan and no per-model ceiling, so a
              heavy week on one model does not lock the others. A cached
              re-read costs a tenth of a token. Pay by D17 transfer at La Poste
              in Tunisia, or by card anywhere — the key is issued the moment
              payment clears.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/sign-up"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Start the 3-day trial
              </Link>
              <Link
                href="/playground"
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground"
              >
                Try a prompt first
                <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <span className="text-sm text-muted-foreground">
                No card for the trial · Cancel in the dashboard
              </span>
            </div>
          </div>
        </header>

        <section className="bg-background py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <PricingPlans signedIn={Boolean(user)} />
          </div>
        </section>

        <PricingProof />

        <section className="border-t border-border bg-background py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <PricingFaq />
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-12">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md">
              <p className="text-base font-semibold tracking-tight text-foreground">
                Still deciding?
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Three days, no card. It is the cheapest way to find out whether
                the gateway fits how you work.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/sign-up"
                className="inline-flex h-10 items-center rounded-xl bg-foreground px-4 font-medium text-background transition-opacity hover:opacity-90"
              >
                Start the trial
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-10 items-center rounded-xl border border-border px-4 font-medium text-foreground transition-colors hover:bg-muted"
              >
                Ask a question
              </Link>
            </div>
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
