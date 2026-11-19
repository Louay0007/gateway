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
  RATES,
} from "@/lib/pricing/facts";

/**
 * PricingPlans — the five-tier ladder.
 *
 * SHAPE, and why each piece is here:
 *
 *   1. Five cards, each with a one-line "who it's for" and a headline. The
 *      ladder sells four different jobs, so the audience IS the
 *      discriminator — a buyer who reads only prices will pick wrong.
 *   2. A grouped comparison table (Usage / Models / Team / Payment) that
 *      scrolls horizontally on narrow screens and pins the feature column,
 *      because five price columns and a label cannot share 375 pixels.
 *   3. The $/MTok table with input, output and cache-read on separate rows,
 *      because "from $1" hides the rate that actually bills.
 *   4. A ten-question FAQ, answered in the negative where the answer is a
 *      trust claim. "Do you mark up token prices? No." is the only credible
 *      form of that sentence.
 *
 * Server-rendered content, client-rendered CTAs: the checkout needs a
 * session-aware handler, and everything else is static.
 */
export function PricingPlans({ signedIn }: { signedIn: boolean }) {
  return (
    // `min-w-0` on the grid items: a grid child defaults to
    // `min-width: auto`, so it will not shrink below its widest content —
    // which makes an `overflow-x-auto` table inside it set the COLUMN
    // width instead of scrolling, and pushes the whole page sideways on a
    // phone. The section carries its own `min-w-0` for the same reason.
    <div className="grid min-w-0 gap-16">
      {/* ── 1. Cards ─────────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {PLAN_FACTS.map((plan) => {
          const featured = plan.code === FEATURED_PLAN;
          return (
            <article
              key={plan.code}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6",
                featured ? "border-foreground/30 ring-1 ring-foreground/10" : "border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {plan.name}
                </h2>
                {featured ? (
                  <span className="rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium tracking-wide text-background uppercase">
                    Best value
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {plan.forWhom}
              </p>

              {/* Two prices, two weights: the USD ask carries the display
                  size, the dinar ask sits smaller and muted beside it, and
                  the interval is its own unit. One string would read as a
                  single "$15 / 50 DT/mo" figure. */}
              <p className="mt-6 flex flex-wrap items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {usdPrice(plan.priceUsdCents)}
                </span>
                <span className="text-base font-medium tabular-nums text-muted-foreground">
                  {tndPrice(plan.priceTndMillimes)}
                </span>
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>

              <ul className="mt-6 grid gap-2.5 text-sm">
                <Li>
                  <strong className="font-medium text-foreground">{plan.poolLabel} tokens</strong>{" "}
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

              <div className="mt-auto pt-7">
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link href={signedIn ? "/dashboard/billing" : "/sign-up"} />}
                  className="w-full"
                  variant={featured ? "default" : "outline"}
                >
                  {signedIn ? `Switch to ${plan.name}` : `Start with ${plan.name}`}
                  <ArrowRight />
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  3-day trial, no card
                </p>
              </div>
            </article>
          );
        })}
      </div>

      {/* ── 2. Comparison, grouped by job ────────────────────────── */}
      {/* `min-w-0` is load-bearing: this is a grid item, and a grid item's
          default `min-width: auto` refuses to shrink below its widest
          child. Without it the 820px table sets the COLUMN to 822px, the
          `overflow-x-auto` never engages, and the whole page scrolls
          sideways on a phone. The wrapper is what scrolls, not the body. */}
      <section className="min-w-0" aria-labelledby="compare-title">
        <h2 id="compare-title" className="text-2xl font-semibold tracking-tight text-foreground">
          Compare the plans
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every plan is one shared pool. What changes is how big the pool is,
          which models it can be spent on, and how many people can use it.
        </p>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-16 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b border-border text-left">
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-muted/80 px-4 py-3 font-medium text-muted-foreground backdrop-blur"
                >
                  <span className="sr-only">Feature</span>
                </th>
                {PLAN_FACTS.map((plan) => (
                  <th
                    key={plan.code}
                    scope="col"
                    className={cn(
                      "px-4 py-3 font-medium",
                      plan.code === FEATURED_PLAN ? "text-foreground" : "text-foreground/80",
                    )}
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((group) => (
                <React.Fragment key={group.group}>
                  <tr className="border-y border-border bg-muted/40">
                    <th
                      scope="colgroup"
                      colSpan={PLAN_CODES.length + 1}
                      className="px-4 py-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase"
                    >
                      {group.group}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-normal text-muted-foreground"
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
      </section>

      {/* ── 3. Rates ─────────────────────────────────────────────── */}
      <section className="min-w-0" aria-labelledby="rates-title">
        <h2 id="rates-title" className="text-2xl font-semibold tracking-tight text-foreground">
          Token rates
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Per million blended tokens, in US dollars. Blended means input,
          output, cache writes and cache reads all draw from the same pool —
          the split below is what each component costs at list rate.
        </p>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-4 py-2.5 font-medium">Model</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Input</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Output</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Cache read</th>
              </tr>
            </thead>
            <tbody>
              {RATES.map((r) => (
                <tr key={r.alias} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <code className="font-mono text-[13px] font-semibold text-foreground">
                      {r.alias}
                    </code>
                    <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                    ${r.input.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                    ${r.output.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                    ${r.cacheRead.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Your plan&apos;s multiplier applies on top of these list rates.
          Failed requests are never billed.
        </p>
      </section>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
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
        <Minus className="size-4 text-muted-foreground/50" aria-label="not included" />
      ) : value === "Yes" ? (
        <Check className="size-4 text-success" aria-label="included" />
      ) : (
        <span className="tabular-nums text-foreground">{value}</span>
      )}
    </td>
  );
}
