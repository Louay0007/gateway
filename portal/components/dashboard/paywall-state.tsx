/**
 * PaywallState — professional plan comparison for users without an active subscription.
 *
 * Replaces the flat button list with side-by-side plan cards showing features,
 * pricing, and a recommended badge. Features are resolved from i18n keys so
 * the component works across FR/EN/AR without hardcoded strings.
 *
 * Data comes from the subscription bundle's `plans` array (sorted by sortOrder)
 * and the billing service's `listPlans()`. The parent passes the checkout handler
 * so this component stays decoupled from the API call.
 */

import { PlanCard } from './plan-card';
import type { PlanSummary } from '@/lib/billing/state';
import type { D17Lang } from '@/lib/i18n/d17';
import { t17 } from '@/lib/i18n/d17';
import { centsUsd, centsDt } from '@/lib/dashboard/format';

interface PaywallStateProps {
  plans: PlanSummary[];
  lang: D17Lang;
  onCheckout: (planCode: string) => void;
  disabled?: boolean;
}

/**
 * Feature lists per plan code. These are i18n keys resolved at render time
 * so the same component serves all three languages. Adding a new plan requires
 * adding its feature keys here and in d17.ts.
 */
const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'd17.feat_fast_tokens',
    'd17.feat_smart_tokens',
    'd17.feat_keys',
    'd17.feat_rpm',
    'd17.feat_tpm',
  ],
  pro: [
    'd17.feat_smart_tokens',
    'd17.feat_frontier_tokens',
    'd17.feat_keys',
    'd17.feat_rpm',
    'd17.feat_tpm',
    'd17.feat_support',
  ],
};

/** Default feature values when the plan doesn't specify overrides. */
const DEFAULT_FEATURE_VALUES: Record<string, Record<string, string>> = {
  starter: {
    'd17.feat_fast_tokens': '80M',
    'd17.feat_smart_tokens': '32M',
    'd17.feat_keys': '3',
    'd17.feat_rpm': '60',
    'd17.feat_tpm': '100,000',
  },
  pro: {
    'd17.feat_smart_tokens': '210M',
    'd17.feat_frontier_tokens': '85M',
    'd17.feat_keys': '10',
    'd17.feat_rpm': '300',
    'd17.feat_tpm': '500,000',
  },
};

export function PaywallState({
  plans,
  lang,
  onCheckout,
  disabled = false,
}: PaywallStateProps) {
  const t = (key: string, vars?: Record<string, string>) => t17(lang, key, vars);

  return (
    <div className="grid gap-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold tracking-tight">Choose your plan</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Simple token budgets. Pay only for what you use.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => {
          const isPro = plan.code === 'pro';
          const featureKeys = PLAN_FEATURES[plan.code] ?? [];
          const defaults = DEFAULT_FEATURE_VALUES[plan.code] ?? {};
          const features = featureKeys.map((key) => {
            const val = defaults[key];
            return val ? t(key, { count: val, amount: val }) : t(key);
          });

          return (
            <PlanCard
              key={plan.code}
              name={t(isPro ? 'd17.plan_pro_name' : 'd17.plan_starter_name')}
              priceLabel={`${centsDt(plan.priceCents)}/mo`}
              features={features}
              isRecommended={isPro}
              ctaLabel={t('d17.plan_choose')}
              onChoose={() => onCheckout(plan.code)}
              disabled={disabled}
            />
          );
        })}
      </div>
    </div>
  );
}