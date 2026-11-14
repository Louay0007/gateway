"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPlanPrice } from "@/lib/dashboard/format";
import { COMPARISON, PLAN_FACTS, RATES } from "@/lib/pricing/facts";

/**
 * PricingPlans — the Phase 7 rebuild.
 *
 * SHAPE, and why each piece is here:
 *
 *   1. Two cards, each with a one-line "who it's for" and a headline. A tier
 *      with no stated audience makes the buyer compare numbers instead of
 *      fit, and the numbers are identical here — so the audience IS the
 *      discriminator.
 *   2. A grouped comparison table (Usage / Models / Team / Payment), sticky
 *      header, check-or-dash cells. Grouped by the question a buyer is
 *      asking, not by alphabet.
 *   3. The $/MTok table with input, output and cache-read on separate rows,
 *      because "from $1" hides the rate that actually bills.
 *   4. A nine-question FAQ, answered in the negative where the answer is a
 *      trust claim. "Do you mark up token prices? No." is the only credible
 *      form of that sentence.
 *
 * Server-rendered content, client-rendered CTAs: the checkout needs a
 * session-aware handler, and everything else is static.
 */
export function PricingPlans({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="grid gap-16">
      {/* ── 1. Cards ─────────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2">
        {PLAN_FACTS.map((plan) => {
          const featured = plan.code === "pro";
          return (
            <article
              key={plan.code}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6 sm:p-8",
                featured ? "border-foreground/30 ring-1 ring-foreground/10" : "border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {plan.name}
                </h2>
                {featured ? (
                  <span className="rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium tracking-wide text-background uppercase">
                    Most capable
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {plan.forWhom}
              </p>

              <p className="mt-6 flex flex-wrap items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">
                  {formatPlanPrice(plan.priceUsdCents, plan.priceTndMillimes)}
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
                <Li>
                  {plan.maxKeys} API keys
                  {plan.maxSeats > 1 ? ` · ${plan.maxSeats} seats` : " · 1 seat"}
                </Li>
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
      <section aria-labelledby="compare-title">
        <h2 id="compare-title" className="text-2xl font-semibold tracking-tight text-foreground">
          Compare the two plans
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Both plans include the same 50M pool. What changes is which models
          it can be spent on, and how many people can use it.
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-16 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-foreground">
                  Starter
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-foreground">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((group) => (
                <React.Fragment key={group.group}>
                  <tr className="border-y border-border bg-muted/40">
                    <th
                      scope="colgroup"
                      colSpan={3}
                      className="px-4 py-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase"
                    >
                      {group.group}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">
                        {row.label}
                      </th>
                      <Cell value={row.starter} />
                      <Cell value={row.pro} />
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3. Rates ─────────────────────────────────────────────── */}
      <section aria-labelledby="rates-title">
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
