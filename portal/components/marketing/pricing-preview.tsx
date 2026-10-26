"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Infinity, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, PanelSkeleton } from "@/components/dashboard/states";
import { useApi } from "@/lib/api/use-api";
import type { PlanListResponse, ProfileView } from "@/lib/api/types";
import { centsDt, compact } from "@/lib/dashboard/format";

const WHATSAPP_NUMBER = "21656794578";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi, I'm interested in Zaino AI Enterprise plan.")}`;

/**
 * Per-model token pricing from prices/models.yaml.
 */
const MODEL_PRICES: Record<string, { input: number; output: number; label: string }> = {
  fast: { input: 1.00, output: 5.00, label: "Fast (Haiku 5.5)" },
  smart: { input: 3.00, output: 15.00, label: "Smart (Sonnet 5.5)" },
  frontier: { input: 15.00, output: 75.00, label: "Frontier (Opus 5.5)" },
};

function usdPerMtok(usd: number): string {
  return `$${usd.toFixed(2)} / MTok`;
}

export function PricingPreview() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<PlanListResponse>("/api/plans");
  const profile = useApi<ProfileView>("/api/profile");
  
  const isAuthenticated = profile.data !== null && !profile.error;

  if (loading) {
    return (
      <section className="border-t border-gray-200/60 dark:border-gray-800 py-20 sm:py-28 bg-white dark:bg-black">
        <div className="mx-auto max-w-4xl px-4">
          <PanelSkeleton rows={2} />
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="border-t border-gray-200/60 dark:border-gray-800 py-20 sm:py-28 bg-white dark:bg-black">
        <div className="mx-auto max-w-2xl px-4">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </section>
    );
  }

  const plans = data?.plans ?? [];
  const promo = plans.find((p) => p.promo)?.promo ?? null;

  function handleGetStarted(planCode: string) {
    if (isAuthenticated) {
      router.push("/dashboard/billing");
    } else {
      router.push(`/sign-up?plan=${planCode}`);
    }
  }

  return (
    <section id="pricing" className="border-t border-gray-200/60 dark:border-gray-800 py-20 sm:py-28 bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pricing</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl text-gray-900 dark:text-gray-100">
            Token-budget plans. One budget per model tier.
          </h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            Prices in Tunisian Dinars (DT), billed monthly. Each tier stops
            when its blended-token budget runs out — no spend caps, no
            surprises. Pay by D17 transfer at La Poste — proof of payment is
            verified by a person, usually within hours.
          </p>
          {promo ? (
            <div className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-700 dark:text-orange-300">
              <span aria-hidden>🎃</span>
              {promo.label} — {promo.percentOff}% off every plan until 1 Nov,
              00:00 (Tunisia).
            </div>
          ) : null}
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.code}
              className={
                plan.code === "pro"
                  ? "relative flex flex-col rounded-2xl border-2 border-gray-900 dark:border-gray-100 bg-white dark:bg-gray-900 p-8"
                  : "flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8"
              }
            >
              {plan.code === "pro" ? (
                <span className="absolute -top-3 left-8 rounded-full bg-gray-900 dark:bg-gray-700 px-3 py-1 text-xs font-medium text-white">
                  Most popular
                </span>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{plan.name}</h3>
                {plan.code === "pro" ? <Badge>Most popular</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{plan.description}</p>

              <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-4xl font-semibold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                  {centsDt(plan.promo?.priceCents ?? plan.priceCents)}
                </span>
                {plan.promo ? (
                  <span className="text-sm tabular-nums text-gray-500 line-through dark:text-gray-400">
                    {centsDt(plan.promo.originalPriceCents)}
                  </span>
                ) : null}
                <span className="text-sm text-gray-600 dark:text-gray-400">/{plan.interval}</span>
                {plan.promo ? (
                  <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
                    −{plan.promo.percentOff}%
                  </span>
                ) : null}
              </p>

              <ul className="mt-6 grid gap-3 text-sm">
                <Feature icon={<Infinity className="size-4" />}>Token budget per model tier — a tier stops when its blended tokens run out. Failures never count</Feature>
                <Feature>{plan.rpmLimit} calls / minute (rate limit)</Feature>
                <Feature>{compact(plan.tpmLimit ?? 0)} tokens / minute</Feature>
                <Feature>{plan.maxKeys} API keys</Feature>
                {(plan.models ?? []).length > 0 && (
                  <Feature>Models: {(plan.models ?? []).join(", ")}</Feature>
                )}
                {(plan.models ?? []).map((m) => {
                  const t = (plan.tokenLimits as Record<string, number>)?.[m];
                  return (
                    <Feature key={m}>
                      {m}: {t != null ? `${compact(t)} tokens` : "no token cap"}
                    </Feature>
                  );
                })}
              </ul>

              <div className="mt-6 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Token pricing per model
                </p>
                <div className="grid gap-2 text-xs">
                  {(plan.models ?? []).map((modelId) => {
                    const price = MODEL_PRICES[modelId];
                    if (!price) return null;
                    return (
                      <div key={modelId} className="flex items-center justify-between">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{price.label}</span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">
                          In: {usdPerMtok(price.input)} · Out: {usdPerMtok(price.output)}
                        </span>
                      </div>
                    );
                  })}
                  {(plan.models ?? []).length === 0 &&
                    Object.entries(MODEL_PRICES).map(([id, price]) => (
                      <div key={id} className="flex items-center justify-between">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{price.label}</span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">
                          In: {usdPerMtok(price.input)} · Out: {usdPerMtok(price.output)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <Button
                className="mt-8 w-full rounded-full"
                variant={plan.code === "pro" ? "default" : "outline"}
                onClick={() => handleGetStarted(plan.code)}
              >
                {isAuthenticated ? "Go to Billing" : "Get Started"}
              </Button>
            </div>
          ))}
        </div>

        {/* Enterprise CTA */}
        <div className="mt-12 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-8 text-center">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Need Enterprise?</h3>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Custom volume pricing, dedicated support, and SLA agreements for your organization.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 dark:bg-emerald-700 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              <MessageCircle className="size-4" />
              Chat on WhatsApp
            </a>
            <a
              href={`tel:+${WHATSAPP_NUMBER}`}
              className="inline-flex items-center gap-2 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Call +216 56 794 578
            </a>
          </div>
        </div>

        <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">
          Token prices shown are Zaino official USD rates. Your DT cost is calculated
          at the current D17 exchange rate. Questions?{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-900 dark:hover:text-gray-100">
            Contact us on WhatsApp
          </a>{" "}
          or call +216 56 794 578.
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
      {icon ?? <Check className="mt-0.5 size-4 shrink-0 text-black dark:text-white" aria-hidden />}
      <span className="text-gray-600 dark:text-gray-400">{children}</span>
    </li>
  );
}