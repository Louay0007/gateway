import type { Metadata } from "next";
import Link from "next/link";

import { PricingPreview } from "@/components/marketing/pricing-preview";
import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Two plans, priced in US dollars and payable monthly — by D17 transfer at La Poste from Tunisia.",
};

/**
 * /pricing — the page three components already linked to.
 *
 * The navbar, the hero CTA, the footer and the old `PricingPreview` all
 * pointed here; the route did not exist, so every one of them was a dead
 * link that shipped. It carries the same hero + pricing treatment as the
 * landing page so the two read as one site.
 */
export default function PricingPage() {
  return (
    <>
      <Navbar />
      <main className="light-surface pt-16">
        <section className="bg-white py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <div className="max-w-2xl">
              <Badge />
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-black sm:text-5xl">
                Pay monthly, in dollars, or by D17
              </h1>
              <p className="mt-5 text-lg text-gray-600">
                Every plan includes usage, enforces a hard spend ceiling at the
                gateway, and hands you the key the moment payment clears.
              </p>
            </div>
          </div>
        </section>
        <PricingPreview />
        <div className="border-t border-gray-200/60 bg-white py-12">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <Link
              href="/"
              className="text-sm text-gray-600 underline-offset-4 hover:text-black hover:underline"
            >
              ← Back to the homepage
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function Badge() {
  return (
    <span className="inline-flex h-7 w-fit items-center rounded-full border border-black px-3 text-sm font-normal text-black">
      Starter 59 DT / month · Pro 307 DT / month
    </span>
  );
}