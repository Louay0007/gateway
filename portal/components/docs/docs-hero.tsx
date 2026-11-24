import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { promoView } from "@/lib/billing/promo";
import { formatPlanPrice } from "@/lib/dashboard/format";

/**
 * Docs hero + table of contents — shared by public /docs and /dashboard/docs.
 *
 * WHAT WAS WRONG. The hero was a badge, a heading, a lede, a three-chip step
 * list and three `border + bg-card` fact tiles — five stacked containers before
 * the reader reached anything they could copy. On a page whose entire job is
 * "get to the first request", the two facts that matter (base URL, auth
 * header) were the last thing on the fold, sitting in boxes the same size as
 * the decoration around them.
 *
 * NOW. The heading and lede speak once at a readable measure, and the three
 * facts become a single hairline-ruled strip — no card, no border box, no
 * badge. The steps stay, because a "three steps" promise is what makes two
 * minutes credible, but they are inline text rather than a second container.
 *
 * No gradient, no eyebrow badge: the h1 carries its own weight (see the
 * craft floor on kickers).
 */
export function DocsHero({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <section
      className={cn(
        "border-b",
        dashboard ? "border-border bg-background" : "border-border/60 bg-card",
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="max-w-[24ch] text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl">
          One API for every model. First call in two minutes.
        </h1>
        <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-muted-foreground">
          {dashboard ? (
            <>
              Your key, your plan&apos;s tiers, and the exact configs for Codex
              and Claude Code — everything below works with the keys on your{" "}
              <Link
                href="/dashboard/keys"
                className="font-medium text-foreground underline underline-offset-4"
              >
                keys page
              </Link>
              .
            </>
          ) : (
            <>
              A single OpenAI- and Anthropic-compatible endpoint, four model
              tiers, and one shared token pool per plan. Grab a key, paste one
              snippet, and you&apos;re calling.
            </>
          )}
        </p>

        {/* Three steps, inline. A promise of brevity, not a second container. */}
        <ol
          className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground"
          aria-label="Three steps"
        >
          {["Get a key", "Pick a tier", "Send a request"].map((s, i, a) => (
            <li key={s} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold tabular-nums text-foreground/40">
                  {i + 1}
                </span>
                {s}
              </span>
              {i < a.length - 1 ? (
                <ChevronRight className="size-3.5 text-muted-foreground/40" aria-hidden />
              ) : null}
            </li>
          ))}
        </ol>

        {/* The facts, as one ruled strip. These are the values a reader came
            for, so they are set in mono and given the width, not boxed into
            three equal cards that read as decoration. */}
        <dl className="mt-9 grid gap-x-8 gap-y-4 border-t border-border pt-6 sm:grid-cols-3">
          <HeroFact label="Base URL" value="api.zaino.soon.it/v1" mono />
          <HeroFact label="Auth" value="Bearer zn-…" mono />
          <HeroFact label="Models" value="fast · smart · frontier · fable" />
        </dl>
      </div>
    </section>
  );
}

function HeroFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 truncate text-[13px] font-medium text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const TOC = [
  "quickstart",
  "models",
  "openai",
  "anthropic",
  "codex",
  "claude-code",
  "keys",
];

export function DocsToc() {
  // Same promotion module the checkout charges with, so the docs line can
  // never advertise a price the D17 page will not ask for. 1500/50000 are
  // Starter's two list prices (USD cents / exact dinar millimes) since
  // migration 0037; neither is derived from the other.
  // promoView is still consulted so a live campaign discounts the line, but
  // the copy no longer names a date: the Halloween window ended and a
  // hard-coded "until 1 Nov" survived it in production for two weeks.
  const starterPromo = promoView(1500);
  const starterPrice = formatPlanPrice(starterPromo?.priceCents ?? 1500, 50000);
  const labels: Record<string, string> = {
    quickstart: "Quickstart",
    models: "Models",
    openai: "OpenAI",
    anthropic: "Anthropic",
    codex: "Codex",
    "claude-code": "Claude Code",
    keys: "Keys & limits",
  };
  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <div className="sticky top-24 grid gap-0.5">
        <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          On this page
        </p>
        {TOC.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            /* A left accent bar on hover is the "side-tab" tell the design
               detector flags. Replaced with a background wash plus an indent
               shift, which reads as the row being picked up without drawing a
               coloured rule beside it. */
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-all hover:bg-muted hover:pl-4 hover:text-foreground"
          >
            {labels[id]}
          </a>
        ))}
        <div className="mt-5 border-t border-border pt-4">
          <p className="px-3 text-[13px] font-medium text-foreground">
            Need a key?
          </p>
          <p className="mt-1 px-3 text-[11px] leading-relaxed text-muted-foreground">
            Minted in seconds, shown once. Plans start at {starterPrice}/mo —
            50M shared tokens, 3 API keys.
          </p>
          <Button
            size="sm"
            className="mt-3 w-full rounded-lg"
            nativeButton={false}
            render={<Link href="/sign-up" />}
          >
            Get an API key
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
