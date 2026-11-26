import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOCS_PROSE, DOCS_WRAP } from "@/components/docs/docs-layout";
import { PUBLIC_BASE_URL } from "@/components/docs/docs-data";

/**
 * DocsHero — the first viewport of /docs.
 *
 * WHAT THIS REPLACED, and why the replacement is a hierarchy change rather
 * than a restyle. The previous hero was a heading, a lede, a three-chip step
 * list and three equal fact tiles — four stacked containers before a reader
 * reached anything they could copy. Every element had the same weight, so the
 * eye had nowhere to land; and the two values the page exists to deliver (base
 * URL, auth header) sat at the bottom of it, in boxes the same size as the
 * decoration around them.
 *
 * NOW the endpoint is the visual. For a developer, `api.zaino.soon.it/v1` IS
 * the product — it is the string they paste — so it is set as the largest
 * monospace type on the page, after the h1, and everything else ranks below
 * it. Nothing is boxed: one hairline separates the claim from the facts, which
 * is the same hairline every section below uses.
 *
 * No gradient, no eyebrow badge, no icon row. The h1 carries its own weight.
 */
export function DocsHero({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <header className={cn("border-b border-border", dashboard ? "bg-background" : "bg-card")}>
      {/* CONSOLE SCALE. In the signed-in shell this hero sits under a sticky
          header that already names the page, so a 68px marketing masthead
          there is a second title at four times the size of every other
          console heading. `dashboard` keeps the same structure — claim,
          promise, three steps — at the scale the rest of the console uses. */}
      <div className={cn(DOCS_WRAP, dashboard ? "py-8" : "py-16 sm:py-20 lg:py-24")}>
        {/* The claim and its promise, side by side on wide screens so the h1 is
            not fighting a narrow column on a 2560px monitor. `items-start`
            keeps the step list aligned with the first heading line. */}
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between xl:gap-16">
          <div className="min-w-0">
            <h1
              className={cn(
                "text-balance font-semibold text-foreground",
                dashboard
                  ? "max-w-[30ch] text-2xl leading-tight tracking-tight"
                  : "max-w-[22ch] text-[2.5rem] leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]",
              )}
            >
              One API for every model.
            </h1>
            <p
              className={cn(
                DOCS_PROSE,
                "text-muted-foreground",
                dashboard
                  ? "mt-2 text-sm leading-normal"
                  : "mt-6 text-base leading-relaxed sm:text-lg",
              )}
            >
              {dashboard ? (
                <>
                  Your key, your plan&apos;s tiers, and the exact configs for
                  Codex and Claude Code — everything below works with the keys
                  on your{" "}
                  <Link
                    href="/dashboard/keys"
                    className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                  >
                    keys page
                  </Link>
                  .
                </>
              ) : (
                <>
                  A single OpenAI- and Anthropic-compatible endpoint, four model
                  tiers, and one shared token pool per plan. Grab a key, paste
                  one snippet, and you&apos;re calling.
                </>
              )}
            </p>
          </div>

          {/* Three steps, inline. A promise of brevity, not a second container:
              the page says "two minutes" and this is the receipt for it. */}
          <ol
            aria-label="Three steps"
            className="flex shrink-0 flex-col gap-2 text-sm text-muted-foreground xl:w-64 xl:pt-1"
          >
            {["Get a key", "Pick a tier", "Send a request"].map((step, i, all) => (
              <li key={step} className="flex items-center gap-2.5">
                <span className="font-mono text-[0.6875rem] tabular-nums text-foreground/40">
                  {i + 1}
                </span>
                <span className={i === all.length - 1 ? "text-foreground" : undefined}>
                  {step}
                </span>
                {i < all.length - 1 ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        {/* THE FACTS. These are the values a reader came for, so they are set in
            mono and given the largest type in the block instead of being boxed
            into three equal cards that read as decoration. `border-t` is the
            page's only separator; there is no card here to compete with it. */}
        <dl className="mt-12 grid gap-x-10 gap-y-3 border-t border-border pt-6 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)] sm:items-baseline sm:pt-7">
          <div className="min-w-0">
            <dt className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Base URL
            </dt>
            <dd className="mt-2 truncate font-mono text-lg font-medium tracking-[-0.02em] text-foreground sm:text-xl">
              {PUBLIC_BASE_URL.replace(/^https:\/\//, "")}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Auth
            </dt>
            <dd className="mt-2 truncate font-mono text-sm text-foreground">Bearer zn-…</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Models
            </dt>
            <dd className="mt-2 font-mono text-sm text-foreground">
              fast · smart · frontier · fable
            </dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

/**
 * DocsCta — the closing action, kept out of the sections.
 *
 * A single band at the foot of the article rather than a card inside the last
 * section: it is the one place the page asks for something, and burying the
 * ask inside "Keys & limits" made it read as one more fact in a table.
 */
export function DocsCta({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <div className="flex flex-col gap-5 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
      <div className={DOCS_PROSE}>
        <p className="text-xl font-semibold tracking-[-0.02em] text-foreground">
          Ready to make your first call?
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {dashboard
            ? "Mint a key on the keys page — it inherits your plan's tiers and limits."
            : "Create an account, pick Starter or Pro, pay by D17 — your first key is seconds away."}
        </p>
      </div>
      <Button
        size="lg"
        nativeButton={false}
        render={<Link href={dashboard ? "/dashboard/keys" : "/sign-up"} />}
        className="shrink-0 rounded-full bg-foreground px-6 text-background hover:bg-foreground/90"
      >
        {dashboard ? "Manage keys" : "Get an API key"}
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
