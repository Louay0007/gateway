import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import FaqSection from "@/components/marketing/faq-section";

export const metadata: Metadata = {
  title: "FAQ | Zaino AI",
  description:
    "How Zaino bills, what the shared token pool means, which models each plan includes, and how to reach a human.",
};

/**
 * /faq — the standalone FAQ.
 *
 * The same `FaqSection` the landing page renders, so there is exactly one
 * copy of every answer. The footer linked here and the route did not exist,
 * which is the shape of promise this page closes.
 *
 * Landing keeps its embedded section (it sells); this page exists so a
 * link labelled "FAQ" resolves and so the answers have a stable URL to be
 * linked from support replies.
 */
export default function FaqPage() {
  return (
    <>
      <SiteNav active="FAQ" />
      <main className="pt-16">
        <FaqSection />
        <div className="border-t border-gray-200/60 bg-white py-12 dark:border-gray-800 dark:bg-black">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 lg:px-8">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Still unsure which plan fits?
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/pricing"
                className="font-medium underline underline-offset-4"
              >
                Compare plans
              </Link>
              <Link
                href="/contact"
                className="font-medium underline underline-offset-4"
              >
                Ask us directly
              </Link>
            </div>
          </div>
        </div>
      </main>
      <ZainoFooter />
    </>
  );
}
