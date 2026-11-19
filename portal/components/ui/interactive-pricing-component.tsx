'use client';

import React, { useState, useCallback } from 'react';
import { Ambient } from "@/components/marketing/ambient";
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api/use-api';
import type { PlanListResponse, ProfileView } from '@/lib/api/types';
import { compact, tndPrice, usdPrice } from '@/lib/dashboard/format';
import { COMPARISON, PLAN_CODES } from '@/lib/pricing/facts';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';

interface Feature {
  name: string;
  included: boolean;
}

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  /**
   * Both rails, already formatted from the catalog ("$15 / 50 DT").
   * A STRING, not a number: the two prices are independent (0037) so
   * there is nothing to do arithmetic on — and a number here is what
   * let this card invent a 20%-off annual price that nobody sells.
   */
  priceLabel: string | null;
  /** Dinar ask, formatted ("90 DT"). Null when the plan has none. */
  priceTndLabel?: string | null;
  customPrice?: string;
  features: Feature[];
  popular?: boolean;
  buttonText: string;
  buttonVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
}

interface PricingComponentProps {
  plans?: PricingPlan[];
  onPlanSelect?: (planId: string) => void;
  className?: string;
  showComparison?: boolean;
}

/**
 * Fallback cards — used only when `/api/plans` has not answered yet (or
 * failed). Prices come from the catalog whenever it is reachable, so these
 * are a first paint, not a second source of truth.
 *
 * They still have to be RIGHT, because a visitor whose fetch fails sees
 * exactly this. The five tiers are the ladder migration 0046 writes; an
 * "Enterprise / Let's Talk" card lived here until then and advertised a
 * product nobody could buy while hiding Solo, Team and Business.
 */
const zainoPlans: PricingPlan[] = [
  {
    id: 'solo',
    name: 'Solo',
    description: 'Cheapest way onto the strong models',
    priceLabel: '$13',
    priceTndLabel: '39 DT',
    features: [
      { name: '35M shared tokens/month', included: true },
      { name: 'Spendable on Fast and Smart', included: true },
      { name: '2 API keys', included: true },
      { name: '60 requests/min', included: true },
    ],
    buttonText: 'Get Started',
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'For side projects and everyday agent work',
    priceLabel: '$15',
    priceTndLabel: '50 DT',
    features: [
      // 0039: ONE shared pool — the split is the customer's to choose.
      { name: '50M shared tokens/month', included: true },
      { name: 'Spendable on Fast and Smart', included: true },
      { name: '3 API keys', included: true },
      { name: '60 requests/min', included: true },
    ],
    buttonText: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For work that needs the strongest reasoning',
    priceLabel: '$30',
    priceTndLabel: '90 DT',
    features: [
      // 0039: 50M shared. Pro differs by model class and key count —
      // deliberately NOT by token volume — so it must not claim more here.
      { name: '50M shared tokens/month', included: true },
      { name: 'Spendable on Smart, Frontier and Fable', included: true },
      { name: '15 API keys', included: true },
      { name: 'Priority support', included: true },
    ],
    popular: true,
    buttonText: 'Get Started',
  },
  {
    id: 'team',
    name: 'Team',
    description: 'Three times the pool, on one invoice',
    priceLabel: '$80',
    priceTndLabel: '250 DT',
    features: [
      { name: '150M shared tokens/month', included: true },
      { name: 'Spendable on Smart, Frontier and Fable', included: true },
      { name: '30 API keys', included: true },
      { name: 'Priority support', included: true },
    ],
    buttonText: 'Get Started',
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Company-wide rollout with finance in the loop',
    priceLabel: '$160',
    priceTndLabel: '500 DT',
    features: [
      { name: '400M shared tokens/month', included: true },
      { name: 'Spendable on Smart, Frontier and Fable', included: true },
      { name: '100 API keys', included: true },
      { name: 'SSO and audit API', included: true },
      { name: 'Priority support', included: true },
    ],
    buttonText: 'Get Started',
  },
];


/**
 * Map a backend plan onto the landing card.
 *
 * The marketing copy (description, feature bullets) stays local so the
 * section keeps its hand-written voice; the PRICE comes from the catalog so
 * the landing, /pricing, the dashboard and the D17 charge can never show
 * three different numbers. `p.promo` is null outside the Halloween window,
 * in which case the list price is used unchanged.
 */
function fromCatalogPlan(p: PlanListResponse['plans'][number]): PricingPlan {
  const template = zainoPlans.find((t) => t.id === p.code);

  // 0039: ONE pool. The old version emitted one bullet per alias
  // ("25M Fast tokens/month", "25M Smart tokens/month"), which reads as two
  // separate allowances and hides that either can spend the whole amount.
  // State the total once, then what it may be spent on.
  const poolTotal = Object.values(p.tokenLimits ?? {}).reduce(
    (sum, n) => sum + (Number(n) > 0 ? Number(n) : 0),
    0,
  );
  const generatedFeatures: Feature[] =
    poolTotal > 0
      ? [{ name: `${compact(poolTotal)} shared tokens/month`, included: true }]
      : [];
  if ((p.models ?? []).length > 0) {
    generatedFeatures.push({
      name: `Spendable on ${(p.models ?? []).join(', ')}`,
      included: true,
    });
  }
  generatedFeatures.push(
    { name: `${p.maxKeys} API keys`, included: true },
    { name: `${compact(p.tpmLimit ?? 0)} tokens/min`, included: true },
  );

  return {
    id: p.code,
    name: p.name,
    description: template?.description ?? p.description ?? '',
    priceLabel: usdPrice(p.promo?.priceCents ?? p.priceCents),
    priceTndLabel: p.priceTndMillimes ? tndPrice(p.priceTndMillimes) : null,
    features: template?.features ?? generatedFeatures,
    popular: p.code === 'pro',
    buttonText: template?.buttonText ?? 'Get Started',
  };
}

export default function PricingComponent({
  plans: plansProp = zainoPlans,
  onPlanSelect,
  className = '',
  showComparison = true,
}: PricingComponentProps) {
  const router = useRouter();
  // Auth-aware CTA without next-auth's SessionProvider: the provider is
  // not mounted in the marketing tree (see app/layout.tsx), so useSession()
  // returns undefined and crashes prerender. /api/profile answers 401 when
  // signed out — same pattern as PricingPreview — so a successful fetch
  // means authenticated and an error means anonymous.
  const profile = useApi<ProfileView>('/api/profile');
  // Live catalog is the price source of truth. When the caller passes
  // explicit plans (a custom embed), that selection wins.
  const catalog = useApi<PlanListResponse>('/api/plans');
  const usingDefault = plansProp === zainoPlans;
  const plans = React.useMemo(() => {
    if (!usingDefault) return plansProp;
    const rows = catalog.data?.plans ?? [];
    if (rows.length === 0) return zainoPlans;
    // No trailing card is appended: the catalog is the whole ladder now.
    return rows.map(fromCatalogPlan);
  }, [usingDefault, plansProp, catalog.data]);
  const session = profile.data ? { user: profile.data } : null;
  const [activeTab, setActiveTab] = useState<'pricing' | 'comparison'>('pricing');

  const handlePlanSelect = useCallback(
    (planId: string) => {
      if (onPlanSelect) {
        onPlanSelect(planId);
        return;
      }
      // Auth-aware redirect: authenticated → billing, unauthenticated → sign-up
      if (session?.user) {
        router.push('/dashboard/billing');
      } else {
        router.push('/sign-up');
      }
    },
    [onPlanSelect, session, router]
  );

  const formatPrice = useCallback(
    (plan: PricingPlan) => plan.customPrice ?? plan.priceLabel ?? '—',
    [],
  );

  // The comparison table is the catalog's, not a union of whatever bullets
  // happened to be on the cards. The old version built rows by matching
  // feature NAMES across cards, so two tiers whose bullets were worded
  // differently produced two half-empty rows — and the marketing copy, which
  // is hand-written per card, is worded differently on purpose.
  const catalogComparison = React.useMemo(
    () => plans.every((p) => (PLAN_CODES as readonly string[]).includes(p.id)),
    [plans],
  );

  const allFeatures = React.useMemo(() => {
    const featureSet = new Set<string>();
    plans.forEach((plan) => plan.features.forEach((f) => featureSet.add(f.name)));
    return Array.from(featureSet);
  }, [plans]);

  const cell = (value: string) =>
    value === 'Yes' ? (
      <Check className="h-5 w-5 text-[#A558FB] mx-auto" aria-label="Included" strokeWidth={2.5} />
    ) : value === '—' ? (
      <X className="h-5 w-5 text-white/20 mx-auto" aria-label="Not included" strokeWidth={2.5} />
    ) : (
      <span className="text-sm text-white/80">{value}</span>
    );

  return (
    <div className={`relative w-full py-16 px-4 sm:px-6 lg:px-8 overflow-hidden ${className}`}>
      <Ambient />
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-white">
            Choose Your Plan
          </h2>
          <p className="text-lg text-white/60 max-w-2xl mx-auto mb-8">
            Every model, one API. Pay in dinars by D17 transfer anywhere in
            Tunisia, or by card on Starter and Pro.
          </p>

          {/* Tab Navigation */}
          {showComparison && (
            <div className="flex justify-center mb-8">
              <div className="inline-flex items-center bg-white/5 border border-white/10 p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('pricing')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${ activeTab === 'pricing' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white' }`}
                >
                  Pricing
                </button>
                <button
                  onClick={() => setActiveTab('comparison')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${ activeTab === 'comparison' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white' }`}
                >
                  Compare Features
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content. Five tiers do not fit a 3-column row without one card
            orphaned on its own line, so the widest breakpoint lays all five
            out; the featured card's scale is dropped there for the same
            reason — at 1.06 it overlaps its neighbours at this width. */}
        {!showComparison || activeTab === 'pricing' ? (
          <div className="grid gap-6 lg:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 max-w-7xl mx-auto items-stretch">
            {plans.map((plan) => (
              <div key={plan.id} className={`flex flex-col ${plan.popular ? 'relative z-10' : ''}`}>
                {/* Outer wrapper for gradient border on popular card */}
                <div
                  className={`relative rounded-2xl h-full flex flex-col transition-all duration-300 ${ plan.popular ? 'p-[2px] bg-gradient-to-b from-[#A558FB] via-[#4922E5]/70 to-[#4922E5]/20 shadow-[0_0_40px_rgba(76,34,229,0.35)] lg:scale-[1.04] xl:scale-100' : 'border border-white/10 shadow-md hover:shadow-lg bg-[#0b0714]' }`}
                >
                  {/* Inner card */}
                  <div
                    className={`relative rounded-[14px] h-full flex flex-col bg-[#0b0714]`}
                  >
                    {/* Most Popular Badge */}
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
                        <span className="inline-flex items-center rounded-full bg-gradient-to-r from-[#4922E5] to-[#A558FB] px-4 py-1.5 text-xs font-semibold text-white shadow-lg whitespace-nowrap">
                          Most Popular
                        </span>
                      </div>
                    )}

                    {/* Card Header */}
                    <div className="px-6 pt-6 pb-4">
                      <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                      <p className="text-sm text-white/60 mt-1">{plan.description}</p>
                    </div>

                    {/* Card Content */}
                    <div className="px-6 pb-6 flex-1">
                      <div className="mb-6">
                        {/* Two currencies, two weights, one interval: one
                            string made "/month" hang off the dinars and the
                            two amounts read as a single figure. */}
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-4xl font-bold tracking-tight text-white">
                            {formatPrice(plan)}
                          </span>
                          {!plan.customPrice && plan.priceTndLabel && (
                            <span className="text-lg font-medium text-white/60 tabular-nums">
                              {plan.priceTndLabel}
                            </span>
                          )}
                          {!plan.customPrice && (
                            <span className="text-white/50 text-sm">/month</span>
                          )}
                        </div>
                        {plan.customPrice && (
                          <div className="text-sm text-white/50 mt-1">
                            Custom pricing for your team
                          </div>
                        )}
                      </div>

                      <ul className="space-y-3">
                        {plan.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <div
                              className={`mt-0.5 shrink-0 ${ feature.included ? 'text-[#A558FB]' : 'text-white/20' }`}
                            >
                              {feature.included ? (
                                <Check className="h-5 w-5" aria-hidden="true" strokeWidth={2.5} />
                              ) : (
                                <X className="h-5 w-5" aria-hidden="true" strokeWidth={2.5} />
                              )}
                            </div>
                            <span
                              className={`text-sm ${ feature.included ? 'text-white' : 'text-white/50' }`}
                            >
                              {feature.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Card Footer — mt-auto pushes it to bottom for equal height */}
                    <div className="px-6 pb-6 pt-4 border-t border-white/10 mt-auto">
                      <Button
                        onClick={() => handlePlanSelect(plan.id)}
                        variant={plan.buttonVariant || (plan.popular ? 'default' : 'outline')}
                        className="w-full transition-all duration-200 h-11 text-base font-semibold"
                      >
                        {plan.buttonText}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-7xl mx-auto">
            <div
              className="overflow-x-auto rounded-xl border border-white/10 shadow-lg bg-[#0b0714]"
            >
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-b-2 border-white/10">
                    <th className="sticky left-0 z-10 bg-[#0b0714] text-left py-4 px-4 font-semibold text-white">
                      Features
                    </th>
                    {plans.map((plan) => (
                      <th key={plan.id} className="text-center py-4 px-4 min-w-[160px]">
                        <div className="space-y-1">
                          <div className="font-bold text-white">{plan.name}</div>
                          <div className="text-2xl font-bold text-white">{formatPrice(plan)}</div>
                          {!plan.customPrice && plan.priceTndLabel && (
                            <div className="text-sm font-medium text-white/60 tabular-nums">
                              {plan.priceTndLabel}
                            </div>
                          )}
                          {!plan.customPrice && (
                            <div className="text-xs text-white/50">/month</div>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catalogComparison
                    ? COMPARISON.flatMap((group) => [
                        <tr key={`group-${group.group}`}>
                          <td
                            colSpan={plans.length + 1}
                            className="pt-6 pb-2 px-4 text-xs font-semibold uppercase tracking-wider text-white/40"
                          >
                            {group.group}
                          </td>
                        </tr>,
                        ...group.rows.map((row) => (
                          <tr
                            key={`${group.group}-${row.label}`}
                            className="border-b border-white/5 hover:bg-white/5 transition-colors"
                          >
                            <td className="sticky left-0 z-10 bg-[#0b0714] py-4 px-4 font-medium text-white">
                              {row.label}
                            </td>
                            {plans.map((plan) => (
                              <td
                                key={`${plan.id}-${row.label}`}
                                className="text-center py-4 px-4"
                              >
                                {cell(row.values[plan.id as keyof typeof row.values])}
                              </td>
                            ))}
                          </tr>
                        )),
                      ])
                    : allFeatures.map((featureName, idx) => (
                        <tr
                          key={featureName}
                          className={`border-b border-white/5 hover:bg-white/5 transition-colors ${ idx % 2 === 0 ? '' : 'bg-white/[0.02]' }`}
                        >
                          <td className="py-4 px-4 font-medium text-white">{featureName}</td>
                          {plans.map((plan) => {
                            const feature = plan.features.find((f) => f.name === featureName);
                            return (
                              <td key={`${plan.id}-${featureName}`} className="text-center py-4 px-4">
                                {feature?.included ? (
                                  <Check className="h-5 w-5 text-[#A558FB] mx-auto" aria-label="Included" strokeWidth={2.5} />
                                ) : (
                                  <X className="h-5 w-5 text-white/20 mx-auto" aria-label="Not included" strokeWidth={2.5} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 pt-8 border-t border-white/10">
          <p className="text-sm text-white/50">
            Pay by D17 transfer (Tunisia), or by card on Starter and Pro.
            Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
