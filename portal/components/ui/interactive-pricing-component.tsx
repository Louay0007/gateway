'use client';

import React, { useState, useCallback } from 'react';
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
    monthlyPrice: 60,
    annualPrice: 48,
    features: [
      { name: '500 GLM 5.3 requests/mo', included: true },
      { name: '250 Sonnet 5 requests/mo', included: true },
      { name: 'Basic agent workflows', included: true },
      { name: 'Community support', included: true },
      { name: 'Opus 5.5 access', included: false },
      { name: 'Priority queue', included: false },
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
      { name: '1000 Sonnet 5 requests/mo', included: true },
      { name: '500 Opus 5.5 requests/mo', included: true },
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
      { name: 'Unlimited Sonnet 5 requests', included: true },
      { name: 'Unlimited Opus 5.5 requests', included: true },
      { name: 'Unlimited GLM 5.3 requests', included: true },
      { name: 'Fable 5.1 access', included: true },
      { name: 'GPT-6 Astra access', included: true },
      { name: 'Dedicated support & SLA', included: true },
    ],
    buttonText: "Let's Talk",
    buttonVariant: 'outline',
  },
];

export default function PricingComponent({
  plans = zainoPlans,
  onPlanSelect,
  defaultBillingCycle = 'monthly',
  currency = 'DT',
  annualDiscount = 20,
  className = '',
  showComparison = true,
}: PricingComponentProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(defaultBillingCycle);
  const [activeTab, setActiveTab] = useState<'pricing' | 'comparison'>('pricing');

  const handlePlanSelect = useCallback(
    (planId: string) => {
      onPlanSelect?.(planId, billingCycle);
    },
    [onPlanSelect, billingCycle]
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
    <div className={`w-full py-16 px-4 sm:px-6 lg:px-8 ${className}`}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-foreground">
            Choose Your Plan
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Every model, one API. Simple prompt-based pricing with D17 payment.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span
              className={`text-sm font-medium transition-colors ${
                billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'
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
                billingCycle === 'annual' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Annual
            </span>
            {billingCycle === 'annual' && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Save up to {annualDiscount}%
              </Badge>
            )}
          </div>

          {/* Tab Navigation */}
          {showComparison && (
            <div className="flex justify-center mb-8">
              <div className="inline-flex items-center bg-muted p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('pricing')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'pricing'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Pricing
                </button>
                <button
                  onClick={() => setActiveTab('comparison')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'comparison'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
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
                      ? 'p-[2px] bg-gradient-to-b from-primary via-primary/60 to-primary/20 shadow-xl scale-[1.03] lg:scale-[1.06]'
                      : 'border border-border shadow-md hover:shadow-lg'
                  }`}
                  style={plan.popular ? undefined : { backgroundColor: 'var(--muted)' }}
                >
                  {/* Inner card */}
                  <div
                    className={`relative rounded-[14px] h-full flex flex-col ${
                      plan.popular ? 'bg-background' : ''
                    }`}
                    style={plan.popular ? undefined : { backgroundColor: 'var(--muted)' }}
                  >
                    {/* Most Popular Badge */}
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
                        <span className="inline-flex items-center rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg whitespace-nowrap">
                          Most Popular
                        </span>
                      </div>
                    )}

                    {/* Card Header */}
                    <div className="px-6 pt-6 pb-4">
                      <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                    </div>

                    {/* Card Content */}
                    <div className="px-6 pb-6 flex-1">
                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold tracking-tight text-foreground">
                            {formatPrice(plan)}
                          </span>
                          {!plan.customPrice && (
                            <span className="text-muted-foreground text-sm">
                              /{billingCycle === 'annual' ? 'mo' : 'month'}
                            </span>
                          )}
                        </div>
                        {billingCycle === 'annual' && !plan.customPrice && plan.monthlyPrice && plan.annualPrice && (
                          <div className="text-sm text-primary mt-1 font-medium">
                            Billed annually • Save {getAnnualSavings(plan)}%
                          </div>
                        )}
                        {plan.customPrice && (
                          <div className="text-sm text-muted-foreground mt-1">
                            Custom pricing for your team
                          </div>
                        )}
                      </div>

                      <ul className="space-y-3">
                        {plan.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <div
                              className={`mt-0.5 shrink-0 ${
                                feature.included ? 'text-primary' : 'text-muted-foreground/40'
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
                                feature.included ? 'text-foreground' : 'text-muted-foreground'
                              }`}
                            >
                              {feature.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Card Footer — mt-auto pushes it to bottom for equal height */}
                    <div className="px-6 pb-6 pt-4 border-t border-border/50 mt-auto">
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
              className="overflow-x-auto rounded-xl border border-border shadow-lg"
              style={{ backgroundColor: 'var(--muted)' }}
            >
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="text-left py-4 px-4 font-semibold text-foreground">Features</th>
                    {plans.map((plan) => (
                      <th key={plan.id} className="text-center py-4 px-4 min-w-[160px]">
                        <div className="space-y-1">
                          <div className="font-bold text-foreground">{plan.name}</div>
                          <div className="text-2xl font-bold text-foreground">{formatPrice(plan)}</div>
                          {!plan.customPrice && (
                            <div className="text-xs text-muted-foreground">
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
                      className={`border-b border-border/50 hover:bg-background/50 transition-colors ${
                        idx % 2 === 0 ? '' : 'bg-background/30'
                      }`}
                    >
                      <td className="py-4 px-4 font-medium text-foreground">{featureName}</td>
                      {plans.map((plan) => {
                        const feature = plan.features.find((f) => f.name === featureName);
                        return (
                          <td key={`${plan.id}-${featureName}`} className="text-center py-4 px-4">
                            {feature?.included ? (
                              <Check className="h-5 w-5 text-primary mx-auto" aria-label="Included" strokeWidth={2.5} />
                            ) : (
                              <X className="h-5 w-5 text-muted-foreground/40 mx-auto" aria-label="Not included" strokeWidth={2.5} />
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
        <div className="text-center mt-12 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Pay securely with D17. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}