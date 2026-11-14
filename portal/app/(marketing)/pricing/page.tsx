import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { PageHeader } from "@/components/ui/page-header";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { PricingFaq } from "@/components/marketing/pricing-faq";
import { currentUser } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Pricing Plans",
  description:
    "Two plans, 50M shared tokens each, priced in US dollars or Tunisian dinars. No per-model ceiling, no markup on token rates, failed requests never billed.",
  alternates: { canonical: "/pricing" },
};

/**
 * /pricing — the last screen before someone pays.
 *
 * REBUILT to the pattern every competitor converged on, because the previous
 * version was a correct price table with no structure: it never said who a
 * plan was for, it grouped nothing, and it answered none of the questions an
 * aggregator's buyer asks before trusting a gateway with money.
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
        <section className="border-b border-border bg-background py-14 sm:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow="Pricing"
              title="Pay monthly, in dollars or dinars"
              lede={
                <>
                  Two plans, the same 50M pool each, no per-model ceiling and no
                  markup on token rates. Pay by D17 transfer at La Poste from
                  Tunisia, or by card anywhere — the key is issued the moment
                  payment clears.
                </>
              }
            />
            <p className="mt-4 text-sm text-muted-foreground">
              Not sure it works for you?{" "}
              <Link
                href="/playground"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Try a prompt on your own key
              </Link>{" "}
              — the playground shows the real cost of the call.
            </p>
          </div>
        </section>

        <section className="bg-background py-12 sm:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
            <PricingPlans signedIn={Boolean(user)} />
          </div>
        </section>

        <section className="border-t border-border bg-background py-12 sm:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
            <PricingFaq />
          </div>
        </section>

        <section className="border-t border-border bg-background py-12">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div>
              <p className="text-base font-semibold tracking-tight text-foreground">
                Still deciding?
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The trial is three days and needs no card. It is the cheapest
                way to find out.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/sign-up"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/80"
              >
                Start the trial
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-9 items-center rounded-lg border border-border px-4 font-medium text-foreground hover:bg-muted"
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
