import type { Metadata } from "next";
import Link from "next/link";

import { PricingPreview } from "@/components/marketing/pricing-preview";
import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { listPlans } from "@/lib/billing/service";
import type { PlanSummary } from "@/lib/billing/state";
import { centsDt } from "@/lib/dashboard/format";

export const metadata: Metadata = {
  title: "Pricing Plans",
  description:
    "Two plans, priced in US dollars and payable monthly — by D17 transfer at La Poste from Tunisia.",
};

/**
 * Rendered per request, not at build time.
 *
 * This page is a server component that calls `listPlans()` — a database
 * query. Without this, Next tries to prerender it during `next build`, and
 * the build container has no database: it fails with
 * `connect ECONNREFUSED 127.0.0.1:5432` on the placeholder DSN the
 * Dockerfile sets. That took the whole image build down, not just this page.
 *
 * The Dockerfile documents the invariant this restores — "every page that
 * touches the database is `force-dynamic`" — and this file was the only
 * one breaking it. It is also the correct behaviour regardless: prices come
 * from the `plans` table, so prerendering would freeze a stale snapshot
 * into the image.
 */
export const dynamic = "force-dynamic";

/**
 * /pricing — the page three components already linked to.
 *
 * The navbar, the hero CTA, the footer and the old `PricingPreview` all
 * pointed here; the route did not exist, so every one of them was a dead
 * link that shipped. It carries the same hero + pricing treatment as the
 * landing page so the two read as one site.
 */
export default async function PricingPage() {
  // The badge reads the same catalog the cards below it render. It used to
  // be a hardcoded string that had drifted a long way from the database —
  // it advertised 59/307 DT while the plans actually cost 50/90 — so the
  // page contradicted the pricing table two inches below it. One source,
  // and no way for the two to disagree again.
  const plans = await listPlans();
  const promo = plans.find((p) => p.promo)?.promo ?? null;

  return (
    <>
      <Navbar />
      <main className="pt-16">
        <section className="bg-white dark:bg-black py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <div className="max-w-2xl">
              <Badge plans={plans} />
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
                Pay monthly, in dollars, or by D17
              </h1>
              <p className="mt-5 text-lg text-gray-600 dark:text-gray-400">
                Every plan includes usage, enforces a hard spend ceiling at the
                gateway, and hands you the key the moment payment clears.
              </p>
              {promo ? (
                <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-700 dark:text-orange-300">
                  <span aria-hidden>🎃</span>
                  {promo.label} — {promo.percentOff}% off every plan until 1 Nov,
                  00:00 (Tunisia). Applied automatically at checkout.
                </div>
              ) : null}
            </div>
          </div>
        </section>
        <PricingPreview />
        <div className="border-t border-gray-200/60 dark:border-gray-800 bg-white dark:bg-black py-12">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <Link
              href="/"
              className="text-sm text-gray-600 dark:text-gray-400 underline-offset-4 hover:text-gray-900 dark:hover:text-gray-100 hover:underline"
            >
              ← Back to the homepage
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function Badge({ plans }: { plans: PlanSummary[] }) {
  // `listPlans()` already returns the catalog in `sort_order`; sorting a
  // copy by price would put the wrong plan first for any future tier whose
  // price is not monotonic with its position.
  const line = plans
    .map((p) => {
      const price = p.promo?.priceCents ?? p.priceCents;
      const was = p.promo ? ` (was ${centsDt(p.priceCents)})` : '';
      return `${p.name} ${centsDt(price)}${was} / ${p.interval}`;
    })
    .join(' · ');

  // No catalog (cold DB, migration mid-flight) must not render an empty
  // pill — better to show nothing than " · ".
  if (!line) return null;

  return (
    <span className="inline-flex h-7 w-fit items-center rounded-full border border-gray-900 dark:border-gray-700 px-3 text-sm font-normal text-gray-900 dark:text-gray-100">
      {line}
    </span>
  );
}