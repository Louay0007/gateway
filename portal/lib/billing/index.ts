/**
 * Provider selection — the one place the environment picks a PSP.
 *
 * `dev`   — the simulated payment used by local verification.
 * `d17`   — manual payment via La Poste Tunisienne (real in the sense
 *           that a human verifies it; there is no API to call).
 *
 * Importing this module is how every other file gets a provider; none of
 * them knows which one is live — except the checkout route, which may
 * ask for a specific one by name when a customer picks a method.
 */

import { devBillingProvider } from './dev';
import { d17BillingProvider } from './d17';
import type { BillingProvider } from './types';

const PROVIDERS = {
  dev: devBillingProvider,
  d17: d17BillingProvider,
} as const;

export type BillingProviderName = keyof typeof PROVIDERS;

function configuredName(): BillingProviderName {
  const name = (process.env.BILLING_PROVIDER ?? 'dev').toLowerCase();
  if (name === 'd17' || name === 'dev') return name;
  throw new Error(`BILLING_PROVIDER must be 'dev' or 'd17' (got '${name}').`);
}

/** The configured provider. */
export const billingProvider: BillingProvider = PROVIDERS[configuredName()];

/**
 * A named provider, for the "choose your payment method" surface.
 *
 * Falls back to the configured provider for an unknown name rather than
 * throwing: a customer's method choice must not crash checkout, it
 * should just pay the configured way.
 */
export function resolveBillingProvider(name?: string | null): BillingProvider {
  if (name && name in PROVIDERS) {
    return PROVIDERS[name as BillingProviderName];
  }
  return billingProvider;
}

export * from './types';
export {
  planStateFromStatus,
  summarizePlan,
  BillingError,
  type PlanState,
  type PlanSummary,
  type BillingErrorCode,
} from './state';
export {
  beginCheckout,
  applyCallback,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  startTrial,
  trialEligibility,
  subscriptionBundle,
  planStateFor,
  listPlans,
  usageHistory,
  usageHistorySeries,
} from './service';
export type {
  UsageHistoryQuery,
  UsageRowView,
  UsageBucket,
  UsageSeries,
  UsageSeriesPoint,
  UsageSeriesQuery,
} from './service';
