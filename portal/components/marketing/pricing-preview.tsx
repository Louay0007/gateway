"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, PanelSkeleton } from "@/components/dashboard/states";
import { useApi } from "@/lib/api/use-api";
import type { PlanListResponse } from "@/lib/api/types";
import { centsUsd, centsDt, compact } from "@/lib/dashboard/format";

/**
 * PricingPreview — the plan table, live.
 *
 * Was a hardcoded array that said **"19 DT/month"** for a plan the database
 * stores as `price_cents = 1613` USD. At the configured D17 rate (3.1 TND per
 * USD) that plan is 49.997 DT — the old component was wrong by the price AND
 * the currency, on the page whose entire job is to state the price.
 *
 * The table now reads `GET /api/plans`, so the number on the page is the
 * same row the entitlement sync reads. Where TND genuinely applies — the D17
 * transfer amount — it is labelled as the D17 conversion and is NOT shown
 * here, because it moves with `D17_USD_TND_RATE` and a pricing page that
 * hardcodes an FX rate is wrong the day the rate is wrong.
 *
 * Public on purpose: `GET /api/plans` is the one endpoint with no session
 * and no org-scoped data. Plan rows are catalog.
 */
export function PricingPreview() {
  const { data, error, loading, reload } = useApi<PlanListResponse>("/api/plans");

  if (loading) {
    return (
      <section className="border-t border-gray-200/60 py-20 sm:py-28 bg-white">
        <div className="mx-auto max-w-4xl px-4">
          <PanelSkeleton rows={2} />
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="border-t border-gray-200/60 py-20 sm:py-28 bg-white">
        <div className="mx-auto max-w-2xl px-4">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </section>
    );
  }

  const plans = data?.plans ?? [];

  return (
    <section id="pricing" className="border-t border-gray-200/60 py-20 sm:py-28 bg-white">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-gray-600">Pricing</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl text-black">
            Two plans. Usage included, never a surprise.
          </h2>
          <p className="mt-4 text-gray-600">
            Prices are in Tunisian Dinars and billed monthly. Pay any plan by
            D17 transfer at La Poste — proof of payment is verified by a person,
            usually within hours.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.code}
              className={
                plan.code === "pro"
                  ? "relative flex flex-col rounded-2xl border-2 border-black bg-white p-8"
                  : "flex flex-col rounded-2xl border border-gray-200 bg-white p-8"
              }
            >
              {plan.code === "pro" ? (
                <span className="absolute -top-3 left-8 rounded-full bg-black px-3 py-1 text-xs font-medium text-white">
                  Most popular
                </span>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-black">{plan.name}</h3>
                {plan.code === "pro" ? <Badge>Most popular</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-gray-600">{plan.description}</p>

              <p className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight tabular-nums text-black">
                  {centsDt(plan.priceCents)}
                </span>
                <span className="text-sm text-gray-600">/{plan.interval}</span>
              </p>

              <ul className="mt-6 grid gap-3 text-sm">
                <Feature>{centsUsd(plan.includedSpendCents)} of usage included</Feature>
                <Feature>
                  {centsUsd(plan.hardCapCents ?? plan.includedSpendCents)} spend
                  cap — traffic stops there
                </Feature>
                <Feature>{plan.rpmLimit} requests / minute</Feature>
                <Feature>{compact(plan.tpmLimit ?? 0)} tokens / minute</Feature>
                <Feature>{plan.maxKeys} API keys</Feature>
                <Feature>{(plan.rateMultiplierBps / 10000).toFixed(2)}× usage rate</Feature>
                <Feature>{(plan.models ?? []).join(", ") || "models"}</Feature>
                {Object.entries(plan.promptLimits ?? {}).map(([alias, limit]) => (
                  <Feature key={alias}>{limit} {alias} prompts / month</Feature>
                ))}
              </ul>

              <Button
                nativeButton={false}
                render={<Link href="/sign-up" />}
                className="mt-8 w-full rounded-full"
                variant={plan.code === "pro" ? "default" : "outline"}
              >
                Start with {plan.name}
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-gray-600">
          Pay by D17 transfer at La Poste — proof of payment is verified by a
          person, usually within hours. Need another payment method?{" "}
          <Link href="/" className="underline hover:text-black">
            Get in touch
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className="mt-0.5 size-4 shrink-0 text-black" aria-hidden />
      <span className="text-gray-600">{children}</span>
    </li>
  );
}