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
import { compact, formatPlanPrice } from '@/lib/dashboard/format';

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
    // 0039: ONE shared pool, stated once. The per-alias token keys that used
    // to live here listed a split the customer was never actually held to.
    'd17.feat_pool_tokens',
    'd17.feat_keys',
    'd17.feat_rpm',
    'd17.feat_tpm',
  ],
  pro: [
    'd17.feat_pool_tokens',
    'd17.feat_keys',
    'd17.feat_rpm',
    'd17.feat_tpm',
    'd17.feat_support',
  ],
};

/**
 * Default feature values when a plan row carries no override.
 *
 * THE MODEL IS ONE SHARED POOL PER PLAN (migration 0039): 50M per month,
 * spendable on whichever of the plan's models the customer likes. Pro is
 * the same 50M as Starter — it differs by model class, 15 keys and 25
 * seats — so both must state the same number here or the paywall invents a
 * volume difference that does not exist.
 *
 * `planFeatureValues()` below reads the live `plans.token_limits` row and
 * wins whenever it has a value; this table is only the fallback for a plan
 * whose budgets are empty (one an operator created before 0023), so it has
 * to state the same truth.
 */
const DEFAULT_FEATURE_VALUES: Record<string, Record<string, string>> = {
  starter: {
    'd17.feat_pool_tokens': '50M',
    'd17.feat_keys': '3',
    'd17.feat_rpm': '60',
    'd17.feat_tpm': '100,000',
  },
  pro: {
    'd17.feat_pool_tokens': '50M',
    'd17.feat_keys': '15',
    'd17.feat_rpm': '300',
    'd17.feat_tpm': '500,000',
  },
};

/**
 * Live values from the plan row — the paywall must not disagree with the
 * gateway.
 *
 * 0039: the pool is the SUM of `token_limits`, not one entry per alias.
 * Rounding DOWN is deliberate and load-bearing: a paywall that promises
 * more than the wall enforces is a support ticket, and the direction of the
 * error is the whole point.
 */
function planFeatureValues(plan: PlanSummary): Record<string, string> {
  const values: Record<string, string> = {
    'd17.feat_keys': String(plan.maxKeys),
    'd17.feat_rpm': plan.rpmLimit ? String(plan.rpmLimit) : '',
    'd17.feat_tpm': plan.tpmLimit ? compact(plan.tpmLimit) : '',
  };
  const pool = Object.values(plan.tokenLimits ?? {}).reduce(
    (sum, n) => sum + (Number(n) > 0 ? Number(n) : 0),
    0,
  );
  if (pool > 0) values['d17.feat_pool_tokens'] = compact(pool);
  return values;
}

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
          const live = planFeatureValues(plan);
          const features = featureKeys.map((key) => {
            const val = live[key] || defaults[key];
            return val ? t(key, { count: val, amount: val }) : t(key);
          });

          return (
            <PlanCard
              key={plan.code}
              name={t(isPro ? 'd17.plan_pro_name' : 'd17.plan_starter_name')}
              priceLabel={`${formatPlanPrice(plan.promo?.priceCents ?? plan.priceCents, plan.priceTndMillimes)}/mo`}
              originalPriceLabel={
                plan.promo ? `${formatPlanPrice(plan.promo.originalPriceCents, plan.priceTndMillimes)}/mo` : undefined
              }
              promoLabel={plan.promo ? `${plan.promo.percentOff}% off — Halloween` : undefined}
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