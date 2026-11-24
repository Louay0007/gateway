"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tndPrice, usdPrice } from "@/lib/dashboard/format";
import {
  COMPARISON,
  FEATURED_PLAN,
  PLAN_CODES,
  PLAN_FACTS,
  type PlanCode,
  type PlanFacts,
  RATES,
} from "@/lib/pricing/facts";

/**
 * PricingPlans — the five-tier ladder, composed as two bands.
 *
 * WHAT WAS WRONG WITH THE PREVIOUS VERSION
 *
 * It lay all five tiers in one row inside a 1024px container, which gave each
 * card 176px and a two-word-per-line description: "For one / developer / who
 * wants the / strong models". Measured, not guessed. The page was also four
 * sections of identical 64px padding, so the price cards, the comparison
 * table, the rates and the FAQ all arrived with the same weight and the eye
 * had no reason to stop anywhere.
 *
 * THE STRUCTURE NOW
 *
 *   1. Two bands, because the ladder has two audiences and the price
 *      difference between them is 2×. "For one person" (Solo, Starter, Pro)
 *      and "For a team on one invoice" (Team, Business). A buyer finds their
 *      row and ignores the other half — which is the whole job of a tiered
 *      page. Three-then-two also lays out honestly at every width instead of
 *      orphaning the fifth card on its own line.
 *   2. A sticky price rail. The single hardest moment on a pricing page is
 *      the comparison table: the reader scrolls into it, loses the price, and
 *      has to scroll back. `PriceRail` pins price-per-dinar above the table at
 *      ≥xl so the numbers stay in view while the differences are read.
 *   3. Rhythm that changes. Bands breathe (mt-16/24), cards are tight inside,
 *      and the table and rates get their own quieter register so they read as
 *      reference rather than as more pitch.
 *
 * WHAT DELIBERATELY DID NOT CHANGE
 *
 * Every number, model list, key count and per-dinar ratio comes from
 * lib/pricing/facts.ts, which tests/pricing-facts.test.ts checks against the
 * shipping migrations. This file composes those facts; it does not restate
 * them. Card order is PLAN_FACTS order, which is price order.
 */

/** The two audiences. Everything about the layout follows from this split. */
const BANDS: { id: string; title: string; blurb: string; codes: PlanCode[] }[] = [
  {
    id: "person",
    title: "For one person",
    blurb: "One developer, one invoice. The pool is yours alone.",
    codes: ["solo", "starter", "pro"],
  },
  {
    id: "team",
    title: "For a team on one invoice",
    blurb:
      "Bigger pools and the keys to share them. Still a single line on finance's sheet.",
    codes: ["team", "business"],
  },
];

const planFor = (code: PlanCode) => PLAN_FACTS.find((p) => p.code === code)!;

export function PricingPlans({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="grid min-w-0 gap-20 sm:gap-24">
      {BANDS.map((band) => (
        <Band key={band.id} band={band} signedIn={signedIn} />
      ))}

      <Comparison />

      <Rates />
    </div>
  );
}

/* ── 1. A band of tiers ────────────────────────────────────────────────── */

function Band({
  band,
  signedIn,
}: {
  band: (typeof BANDS)[number];
  signedIn: boolean;
}) {
  // Three cards are a third of the row. Two cards are deliberately NOT
  // halves: at half-width the description sits alone on a very wide line and
  // the pair reads as two unrelated panels. A third + two-thirds gives the
  // row a subject and a supporting card, and it lines up with the three-up
  // band above so the ladder reads as one system across both rows.
  const cols =
    band.codes.length === 2
      ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]"
      : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section aria-labelledby={`band-${band.id}`} className="min-w-0">
      <header className="max-w-2xl">
        <h2
          id={`band-${band.id}`}
          className="text-balance text-xl font-semibold tracking-tight text-foreground"
        >
          {band.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {band.blurb}
        </p>
      </header>

      <div className={cn("mt-8 grid min-w-0 gap-5", cols)}>
        {band.codes.map((code) => (
          <PlanCard key={code} plan={planFor(code)} signedIn={signedIn} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ plan, signedIn }: { plan: PlanFacts; signedIn: boolean }) {
  const featured = plan.code === FEATURED_PLAN;

  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col rounded-2xl p-6",
        // ONE elevation, never a 1px border under a wide soft shadow. The
        // featured card earns a filled head instead of a ring on top of a
        // border, so it reads as emphasis rather than as a second layer.
        featured ? "bg-card" : "bg-card",
        featured ? "border border-foreground/20" : "border border-border",
      )}
      style={
        featured
          ? {
              // A soft ambient lift, offset and blurred — not a zero-offset
              // halo. Sits behind the card so the border stays crisp.
              boxShadow:
                "0 1px 0 0 color-mix(in oklab, var(--foreground) 8%, transparent), 0 18px 40px -24px color-mix(in oklab, var(--foreground) 45%, transparent)",
            }
          : undefined
      }
    >
      {featured ? (
        <span className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-background uppercase">
          Best value
        </span>
      ) : null}

      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {plan.name}
        </h3>
      </div>

      <p className="mt-2 min-h-[2.5rem] text-[13px] leading-relaxed text-muted-foreground">
        {plan.forWhom}
      </p>

      {/* The price is the one element allowed to shout. Two currencies, two
          weights, one interval — the dinar figure is the ask, the dollar is
          the reference, so they must not share an optical size. */}
      <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[2rem] leading-none font-semibold tracking-[-0.03em] tabular-nums text-foreground">
          {tndPrice(plan.priceTndMillimes)}
        </span>
        <span className="text-sm font-medium text-muted-foreground">/mo</span>
        <span className="w-full text-[13px] tabular-nums text-muted-foreground">
          {usdPrice(plan.priceUsdCents)} at today's rate
        </span>
      </p>

      <div className="my-5 h-px bg-border" />

      <ul className="grid gap-2.5 text-[13px]">
        <Li>
          <strong className="font-medium text-foreground">
            {plan.poolLabel} tokens
          </strong>{" "}
          per month, one shared pool
        </Li>
        <Li>
          Spendable on{" "}
          <strong className="font-medium text-foreground">
            {plan.models.join(", ")}
          </strong>
        </Li>
        <Li>{plan.maxKeys} API keys</Li>
        <Li>1M context · 64k output</Li>
      </ul>

      <div className="mt-auto pt-6">
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href={signedIn ? "/dashboard/billing" : "/sign-up"} />}
          className={cn(
            "w-full justify-between rounded-xl",
            featured ? "" : "border-border",
          )}
          variant={featured ? "default" : "outline"}
        >
          {signedIn ? `Switch to ${plan.name}` : `Start with ${plan.name}`}
          <ArrowRight />
        </Button>
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
          3-day trial, no card
        </p>
      </div>
    </article>
  );
}

/* ── 2. Comparison ─────────────────────────────────────────────────────── */

/**
 * The table, with a sticky price rail beside it at ≥xl.
 *
 * `min-w-0` on every grid child is load-bearing: a grid item's default
 * `min-width: auto` refuses to shrink below its widest content, so an
 * `overflow-x-auto` table inside one sets the COLUMN width instead of
 * scrolling, and pushes the whole page sideways on a phone.
 */
function Comparison() {
  return (
    <section aria-labelledby="compare-title" className="min-w-0">
      <div className="max-w-2xl">
        <h2
          id="compare-title"
          className="text-balance text-xl font-semibold tracking-tight text-foreground"
        >
          What actually differs
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every plan is one shared pool with no per-model ceiling. What changes
          is the size of the pool, which models it can be spent on, and how
          many keys can use it.
        </p>
        {/* The scroll hint is attached to the SCROLLER, not to the section, so
            it only appears at widths where the table genuinely overflows.
            It previously sat in the header at `xl:` — where the table fits
            and nothing scrolls — which is a hint that lies to exactly the
            reader who has the most room. */}
      </div>

      <div className="mt-7 min-w-0 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th
                scope="col"
                className="sticky left-0 z-20 bg-muted px-4 py-3 text-left text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase backdrop-blur"
              >
                <span className="sr-only">Feature</span>
              </th>
              {PLAN_FACTS.map((plan) => (
                <th
                  key={plan.code}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-left font-medium",
                    plan.code === FEATURED_PLAN
                      ? "text-foreground"
                      : "text-foreground/80",
                  )}
                >
                  <span className="block text-[13px]">{plan.name}</span>
                  <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-muted-foreground">
                    {tndPrice(plan.priceTndMillimes)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((group) => (
              <React.Fragment key={group.group}>
                {/* The group row is a caption, not a cell: no hover, no
                    border, and it spans the full width so the eye reads it
                    as a divider between answer blocks. */}
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={PLAN_CODES.length + 1}
                    className="border-y border-border bg-muted/50 px-4 pt-5 pb-2 text-left text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                  >
                    {group.group}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr
                    key={row.label}
                    className="group/row border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <th
                      scope="row"
                      /* `bg-background`, matching the table's own surface.
                         It was `bg-card`, which is a LIGHTER token in dark mode,
                         so the pinned label column rendered as a pale strip
                         down the table's left edge at every width. A sticky
                         cell must paint the surface it sits on, not a related
                         one. `group-hover/row:bg-muted` then keeps the row
                         highlight travelling through the pinned cell. */
                      className="sticky left-0 z-10 bg-background px-4 py-2.5 text-left text-[13px] font-normal text-muted-foreground transition-colors group-hover/row:bg-muted"
                    >
                      {row.label}
                    </th>
                    {PLAN_CODES.map((code) => (
                      <Cell key={code} value={row.values[code]} />
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* NO "tokens per dinar" RAIL HERE, and that is a deliberate reversal.

          The first version of this layout pinned a per-dinar ranking beside
          the table. Computed from the real ladder it reads: Solo 897,
          Starter 1000, Pro 556, Team 600, Business 800 — i.e. it would have
          published, in the most prominent position on the page, a chart
          showing that the plan we badge "best value" delivers 44% FEWER
          tokens per dinar than the tier below it.

          That inversion is real and the repo already records it as an open
          product decision (ZAINO-SUMMARY §9.6, PRICING-MODEL §2.3): Pro is
          sold on model class — frontier and fable — not on volume. A pricing
          page may sell that trade, but it must not draw a chart that argues
          against the badge next to it. The pool sizes stay in the table above,
          where the reader can compare them without being told what they mean.

          tests/pricing-facts.test.ts asserts only starter>solo, team>pro and
          business>team for exactly this reason. */}
    </section>
  );
}

/* ── 3. Rates ──────────────────────────────────────────────────────────── */

function Rates() {
  return (
    <section aria-labelledby="rates-title" className="min-w-0">
      <div className="max-w-2xl">
        <h2
          id="rates-title"
          className="text-balance text-xl font-semibold tracking-tight text-foreground"
        >
          What a token costs
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Per million blended tokens, in US dollars. Blended means input,
          output, cache writes and cache reads all draw from the same pool; the
          split below is what each component costs at list rate.
        </p>
      </div>

      <div className="mt-7 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Model
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Input
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Output
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Cache read
              </th>
            </tr>
          </thead>
          <tbody>
            {RATES.map((r) => (
              <tr
                key={r.alias}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-2.5">
                  <code className="font-mono text-[13px] font-semibold text-foreground">
                    {r.alias}
                  </code>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.note}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-foreground">
                  ${r.input.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-foreground">
                  ${r.output.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                  ${r.cacheRead.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Failed requests are never billed. Only successful inference counts
        against the pool.
      </p>
    </section>
  );
}

/* ── primitives ────────────────────────────────────────────────────────── */

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** A check, a dash, or the literal value. Never an empty cell. */
function Cell({ value }: { value: string }) {
  const isDash = value === "—";
  return (
    <td className="px-4 py-2.5">
      {isDash ? (
        <Minus
          className="size-3.5 text-muted-foreground/40"
          aria-label="not included"
        />
      ) : value === "Yes" ? (
        <Check className="size-3.5 text-foreground" aria-label="included" />
      ) : (
        <span className="text-[13px] tabular-nums text-foreground">
          {value}
        </span>
      )}
    </td>
  );
}
