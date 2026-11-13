import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { Playground } from "@/components/playground/playground";
import { currentUser } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Playground | Zaino AI",
  description:
    "Send one prompt through the real Zaino gateway on your own key, and see the exact tokens and cost of the call. No demo key, no simulation.",
};

/**
 * /playground — the highest-intent page on any model API.
 *
 * The visitor's own key is the feature, not a limitation. A playground that
 * bills a shared demo key can only show estimated cost; one that runs on the
 * visitor's key shows the ledger number, and that number landing in their
 * own usage is the product proving itself.
 *
 * `force-dynamic` because of `currentUser()`: the signed-in variant offers a
 * link to the keys page, and a prerendered page would bake in the
 * signed-out copy.
 */
export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const user = await currentUser();

  return (
    <>
      <SiteNav active="Playground" />
      <main className="pt-16">
        <section className="border-b border-border bg-background py-14 sm:py-20">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground">Playground</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
              Try it on your own key, and watch the meter.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              One prompt, a streamed answer, and the real token count and cost
              of that call — through the same gateway your production code
              will use. There is no demo key: the usage you see is yours.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Need a key?{" "}
              <Link
                href={user ? "/dashboard/keys" : "/sign-up"}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {user ? "Open your keys" : "Start a 3-day trial"}
              </Link>
              .
            </p>
          </div>
        </section>

        <section className="bg-background py-10 sm:py-14">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <Playground signedIn={Boolean(user)} />
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
