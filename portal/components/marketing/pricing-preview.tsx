"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Infinity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, PanelSkeleton } from "@/components/dashboard/states";
import { useApi } from "@/lib/api/use-api";
import type { PlanListResponse } from "@/lib/api/types";
import { centsDt, compact } from "@/lib/dashboard/format";

/**
 * Per-model token pricing from prices/models.yaml.
 *
 * These are the upstream USD rates per million tokens. Displayed on the
 * pricing card so customers see exactly what they pay per model when
 * using their own keys (BYOK) or comparing against Zaino AI's bundled
 * rate. The YAML is the single source of truth; this object mirrors it
 * for the client component since we cannot read YAML at runtime in a
 * "use client" module.
 *
 * Sync check: tests/pricing-consistency.test.ts fails on drift between
 * this file, models.yaml, and config/litellm.yaml.
 */
const MODEL_PRICES: Record<string, { input: number; output: number; label: string }> = {
  "claude-sonnet-5": { input: 3.0, output: 15.0, label: "Fast (Sonnet 5)" },
  "claude-opus-5-5": { input: 15.0, output: 75.0, label: "Smart (Opus 5.5)" },
  "nemotron-3.5-super-vl-120b-a12b": { input: 0.15, output: 0.6, label: "Frontier (Nemotron)" },
};

/** Format USD per million tokens → "$3.00 / MTok". */
function usdPerMtok(usd: number): string {
  return `$${usd.toFixed(2)} / MTok`;
}

/**
 * PricingPreview — the plan table, live.
 *
 * Prices are displayed in Tunisian Dinars (DT) using the configured D17
 * exchange rate. Plans are unlimited — no spend caps, no hard limits.
 * Customers pay only for the tokens they use at the per-model rates
 * shown below each plan.
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
            Unlimited usage. Pay only for what you consume.
          </h2>
          <p className="mt-4 text-gray-600">
            Prices in Tunisian Dinars (DT), billed monthly. No spend caps, no
            surprises. Pay by D17 transfer at La Poste — proof of payment is
            verified by a person, usually within hours.
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
                <Feature icon={<Infinity className="size-4" />}>Unlimited usage — no spend cap</Feature>
                <Feature>{plan.rpmLimit} requests / minute</Feature>
                <Feature>{compact(plan.tpmLimit ?? 0)} tokens / minute</Feature>
                <Feature>{plan.maxKeys} API keys</Feature>
                {(plan.models ?? []).length > 0 && (
                  <Feature>Models: {(plan.models ?? []).join(", ")}</Feature>
                )}
              </ul>

              {/* Per-model token pricing */}
              <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50/50 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Token pricing per model
                </p>
                <div className="grid gap-2 text-xs">
                  {(plan.models ?? []).map((modelId) => {
                    const price = MODEL_PRICES[modelId];
                    if (!price) return null;
                    return (
                      <div key={modelId} className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">{price.label}</span>
                        <span className="tabular-nums text-gray-600">
                          In: {usdPerMtok(price.input)} · Out: {usdPerMtok(price.output)}
                        </span>
                      </div>
                    );
                  })}
                  {/* Show all models if plan doesn't restrict */}
                  {(plan.models ?? []).length === 0 &&
                    Object.entries(MODEL_PRICES).map(([id, price]) => (
                      <div key={id} className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">{price.label}</span>
                        <span className="tabular-nums text-gray-600">
                          In: {usdPerMtok(price.input)} · Out: {usdPerMtok(price.output)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

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
          Token prices shown are upstream USD rates. Your DT cost is calculated
          at the current D17 exchange rate. Not using Zaino AI? These are the
          same rates you would pay directly to the model providers.{" "}
          <Link href="/" className="underline hover:text-black">
            Get in touch
          </Link>{" "}
          for volume discounts.
        </p>
      </div>
    </section>
  );
}

function Feature({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {icon ?? <Check className="mt-0.5 size-4 shrink-0 text-black" aria-hidden />}
      <span className="text-gray-600">{children}</span>
    </li>
  );
}