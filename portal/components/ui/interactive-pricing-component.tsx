'use client';

import React, { useState, useCallback } from 'react';
import { HalloweenDots } from "@/components/marketing/halloween-dots";
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api/use-api';
import type { PlanListResponse, ProfileView } from '@/lib/api/types';
import { HALLOWEEN_PROMO, promoActive } from '@/lib/billing/promo';
import { centsDtNumber, compact } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';

interface Feature {
  name: string;
  included: boolean;
}

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  customPrice?: string;
  features: Feature[];
  popular?: boolean;
  buttonText: string;
  buttonVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  /** Live discount, when the API reports one. Undefined outside the sale. */
  promo?: {
    label: string;
    percentOff: number;
    originalMonthly: number;
    originalAnnual: number;
  };
}

interface PricingComponentProps {
  plans?: PricingPlan[];
  onPlanSelect?: (planId: string, billingCycle: 'monthly' | 'annual') => void;
  defaultBillingCycle?: 'monthly' | 'annual';
  currency?: string;
  annualDiscount?: number;
  className?: string;
  showComparison?: boolean;
}

const zainoPlans: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for individuals exploring AI coding',
    monthlyPrice: 50,
    annualPrice: 40,
    features: [
      { name: '80M Haiku 5.5 tokens/mo', included: true },
      { name: '32M Sonnet 5.5 tokens/mo', included: true },
      { name: 'Basic agent workflows', included: true },
      { name: 'Community support', included: true },
    ],
    buttonText: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For professionals who need full power',
    monthlyPrice: 90,
    annualPrice: 72,
    features: [
      { name: '210M Sonnet 5.5 tokens/mo', included: true },
      { name: '85M Opus 5.5 tokens/mo', included: true },
      { name: 'Advanced agent workflows', included: true },
      { name: 'Priority support', included: true },
      { name: 'Priority queue', included: true },
      { name: 'Custom integrations', included: true },
    ],
    popular: true,
    buttonText: 'Get Started',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited power for teams and organizations',
    monthlyPrice: null,
    annualPrice: null,
    customPrice: "Let's Talk",
    features: [
      { name: 'Unlimited Haiku 5.5 tokens', included: true },
      { name: 'Unlimited Sonnet 5.5 tokens', included: true },
      { name: 'Unlimited Opus 5.5 tokens', included: true },
      { name: 'Opus 5.5 access', included: true },
      { name: 'Dedicated support & SLA', included: true },
    ],
    buttonText: "Let's Talk",
    buttonVariant: 'outline',
  },
];

const MODEL_LABELS: Record<string, string> = {
  fast: 'Haiku 5.5',
  smart: 'Sonnet 5.5',
  frontier: 'Opus 5.5',
};

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
  const monthly = centsDtNumber(p.promo?.priceCents ?? p.priceCents);
  const originalMonthly = centsDtNumber(p.priceCents);
  const annual = Math.round(monthly * 0.8);
  const originalAnnual = Math.round(originalMonthly * 0.8);

  const generatedFeatures: Feature[] = Object.entries(p.tokenLimits ?? {}).map(
    ([alias, limit]) => ({
      name: `${compact(limit)} ${MODEL_LABELS[alias] ?? alias} tokens/mo`,
      included: true,
    }),
  );
  generatedFeatures.push(
    { name: `${p.maxKeys} API keys`, included: true },
    { name: `${compact(p.tpmLimit ?? 0)} tokens/min`, included: true },
  );

  return {
    id: p.code,
    name: p.name,
    description: template?.description ?? p.description ?? '',
    monthlyPrice: monthly,
    annualPrice: annual,
    features: template?.features ?? generatedFeatures,
    popular: p.code === 'pro',
    buttonText: template?.buttonText ?? 'Get Started',
    promo: p.promo
      ? {
          label: p.promo.label,
          percentOff: p.promo.percentOff,
          originalMonthly,
          originalAnnual,
        }
      : undefined,
  };
}

/** Fallback when the catalog is unreachable: discount the local copy too. */
function applyLocalPromo(plan: PricingPlan): PricingPlan {
  if (!promoActive() || !plan.monthlyPrice || !plan.annualPrice) return plan;
  const percentOff = HALLOWEEN_PROMO.percentOff;
  return {
    ...plan,
    monthlyPrice: Math.round(plan.monthlyPrice * (100 - percentOff) / 100),
    annualPrice: Math.round(plan.annualPrice * (100 - percentOff) / 100),
    promo: {
      label: HALLOWEEN_PROMO.label,
      percentOff,
      originalMonthly: plan.monthlyPrice,
      originalAnnual: plan.annualPrice,
    },
  };
}

export default function PricingComponent({
  plans: plansProp = zainoPlans,
  onPlanSelect,
  defaultBillingCycle = 'monthly',
  currency = 'DT',
  annualDiscount = 20,
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
    if (rows.length === 0) return zainoPlans.map(applyLocalPromo);
    return [
      ...rows.map(fromCatalogPlan),
      ...zainoPlans.filter((p) => p.id === 'enterprise'),
    ];
  }, [usingDefault, plansProp, catalog.data]);
  const activePromo = plans.find((p) => p.promo)?.promo ?? null;
  const session = profile.data ? { user: profile.data } : null;
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(defaultBillingCycle);
  const [activeTab, setActiveTab] = useState<'pricing' | 'comparison'>('pricing');

  const handlePlanSelect = useCallback(
    (planId: string) => {
      if (onPlanSelect) {
        onPlanSelect(planId, billingCycle);
        return;
      }
      // Auth-aware redirect: authenticated → billing, unauthenticated → sign-up
      if (session?.user) {
        router.push('/dashboard/billing');
      } else {
        router.push('/sign-up');
      }
    },
    [onPlanSelect, billingCycle, session, router]
  );

  const handleBillingToggle = useCallback((isAnnual: boolean) => {
    setBillingCycle(isAnnual ? 'annual' : 'monthly');
  }, []);

  const formatPrice = useCallback(
    (plan: PricingPlan) => {
      if (plan.customPrice) return plan.customPrice;
      const price = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
      return `${price} ${currency}`;
    },
    [billingCycle, currency]
  );

  const formatOriginalPrice = useCallback(
    (plan: PricingPlan) => {
      if (!plan.promo) return null;
      const price =
        billingCycle === 'annual'
          ? plan.promo.originalAnnual
          : plan.promo.originalMonthly;
      return `${price} ${currency}`;
    },
    [billingCycle, currency]
  );

  const getAnnualSavings = useCallback((plan: PricingPlan) => {
    if (!plan.monthlyPrice || !plan.annualPrice) return 0;
    const monthlyCost = plan.monthlyPrice * 12;
    const annualCost = plan.annualPrice * 12;
    return Math.round(((monthlyCost - annualCost) / monthlyCost) * 100);
  }, []);

  const allFeatures = React.useMemo(() => {
    const featureSet = new Set<string>();
    plans.forEach((plan) => plan.features.forEach((f) => featureSet.add(f.name)));
    return Array.from(featureSet);
  }, [plans]);

  return (
    <div className={`relative w-full py-16 px-4 sm:px-6 lg:px-8 overflow-hidden ${className}`}>
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <div className="absolute top-1/4 left-[5%] w-72 h-72 rounded-full bg-orange-500/10 blur-[80px] animate-[pulse_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/4 right-[8%] w-64 h-64 rounded-full bg-purple-500/10 blur-[80px] animate-[pulse_11s_ease-in-out_infinite_reverse]" />
      <HalloweenDots />
      </div>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-white">
            Choose Your Plan
          </h2>
          <p className="text-lg text-white/60 max-w-2xl mx-auto mb-8">
            Every model, one API. Simple token budgets with D17 payment.
          </p>

          {activePromo ? (
            <div className="mx-auto mb-8 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-200">
              <span aria-hidden>🎃</span>
              {activePromo.label} — {activePromo.percentOff}% off every plan
              until 1 Nov, 00:00 (Tunisia). Applied automatically at checkout.
            </div>
          ) : null}

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span
              className={`text-sm font-medium transition-colors ${
                billingCycle === 'monthly' ? 'text-white' : 'text-white/50'
              }`}
            >
              Monthly
            </span>
            <Switch
              checked={billingCycle === 'annual'}
              onCheckedChange={handleBillingToggle}
              aria-label="Toggle billing cycle"
            />
            <span
              className={`text-sm font-medium transition-colors ${
                billingCycle === 'annual' ? 'text-white' : 'text-white/50'
              }`}
            >
              Annual
            </span>
            {billingCycle === 'annual' && (
              <Badge variant="secondary" className="ml-2 text-xs bg-orange-500/20 text-orange-300 border-orange-500/30">
                Save up to {annualDiscount}%
              </Badge>
            )}
          </div>

          {/* Tab Navigation */}
          {showComparison && (
            <div className="flex justify-center mb-8">
              <div className="inline-flex items-center bg-white/5 border border-white/10 p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('pricing')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'pricing'
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  Pricing
                </button>
                <button
                  onClick={() => setActiveTab('comparison')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'comparison'
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  Compare Features
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        {!showComparison || activeTab === 'pricing' ? (
          <div className="grid gap-6 lg:gap-8 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto items-stretch">
            {plans.map((plan) => (
              <div key={plan.id} className={`flex flex-col ${plan.popular ? 'relative z-10' : ''}`}>
                {/* Outer wrapper for gradient border on popular card */}
                <div
                  className={`relative rounded-2xl h-full flex flex-col transition-all duration-300 ${
                    plan.popular
                      ? 'p-[2px] bg-gradient-to-b from-orange-500 via-purple-500/60 to-orange-500/20 shadow-[0_0_40px_rgba(255,140,0,0.25)] scale-[1.03] lg:scale-[1.06]'
                      : 'border border-white/10 shadow-md hover:shadow-lg bg-[#14051f]'
                  }`}
                >
                  {/* Inner card */}
                  <div
                    className={`relative rounded-[14px] h-full flex flex-col bg-[#14051f]`}
                  >
                    {/* Most Popular Badge */}
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
                        <span className="inline-flex items-center rounded-full bg-gradient-to-r from-orange-500 to-purple-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg whitespace-nowrap">
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
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-4xl font-bold tracking-tight text-white">
                            {formatPrice(plan)}
                          </span>
                          {formatOriginalPrice(plan) ? (
                            <span className="text-lg font-medium text-white/40 line-through tabular-nums">
                              {formatOriginalPrice(plan)}
                            </span>
                          ) : null}
                          {!plan.customPrice && (
                            <span className="text-white/50 text-sm">
                              /{billingCycle === 'annual' ? 'mo' : 'month'}
                            </span>
                          )}
                        </div>
                        {plan.promo ? (
                          <div className="mt-1 inline-flex items-center rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-300">
                            −{plan.promo.percentOff}% Halloween
                          </div>
                        ) : null}
                        {billingCycle === 'annual' && !plan.customPrice && plan.monthlyPrice && plan.annualPrice && (
                          <div className="text-sm text-orange-400 mt-1 font-medium">
                            Billed annually • Save {getAnnualSavings(plan)}%
                          </div>
                        )}
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
                              className={`mt-0.5 shrink-0 ${
                                feature.included ? 'text-orange-400' : 'text-white/20'
                              }`}
                            >
                              {feature.included ? (
                                <Check className="h-5 w-5" aria-hidden="true" strokeWidth={2.5} />
                              ) : (
                                <X className="h-5 w-5" aria-hidden="true" strokeWidth={2.5} />
                              )}
                            </div>
                            <span
                              className={`text-sm ${
                                feature.included ? 'text-white' : 'text-white/50'
                              }`}
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
          <div className="max-w-5xl mx-auto">
            <div
              className="overflow-x-auto rounded-xl border border-white/10 shadow-lg bg-[#14051f]"
            >
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-white/10">
                    <th className="text-left py-4 px-4 font-semibold text-white">Features</th>
                    {plans.map((plan) => (
                      <th key={plan.id} className="text-center py-4 px-4 min-w-[160px]">
                        <div className="space-y-1">
                          <div className="font-bold text-white">{plan.name}</div>
                          <div className="text-2xl font-bold text-white">{formatPrice(plan)}</div>
                          {formatOriginalPrice(plan) ? (
                            <div className="text-xs text-white/40 line-through">
                              {formatOriginalPrice(plan)}
                            </div>
                          ) : null}
                          {!plan.customPrice && (
                            <div className="text-xs text-white/50">
                              /{billingCycle === 'annual' ? 'mo' : 'month'}
                            </div>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allFeatures.map((featureName, idx) => (
                    <tr
                      key={featureName}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                        idx % 2 === 0 ? '' : 'bg-white/[0.02]'
                      }`}
                    >
                      <td className="py-4 px-4 font-medium text-white">{featureName}</td>
                      {plans.map((plan) => {
                        const feature = plan.features.find((f) => f.name === featureName);
                        return (
                          <td key={`${plan.id}-${featureName}`} className="text-center py-4 px-4">
                            {feature?.included ? (
                              <Check className="h-5 w-5 text-orange-400 mx-auto" aria-label="Included" strokeWidth={2.5} />
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
            Pay securely with D17. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
