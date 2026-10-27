/**
 * One status→tone vocabulary for the whole console.
 *
 * WHY THIS EXISTS. Before this module the same status was coloured in
 * four places with four different rules: the roster rendered a suspended
 * org as `destructive` while its own detail page rendered the same org as
 * `secondary`; `active` meant the brand colour in one table and a filled
 * badge in another. An operator reading two screens side by side was
 * being told two different things about one account, which is worse than
 * no colour at all — colour is a claim about urgency.
 *
 * Pure and JSX-free on purpose: server components and client components
 * both import it, and both must agree.
 *
 * Tones are chosen for MEANING, matching the rule `AdminStat` already
 * documents: `danger` means a human should act now, `warning` means it
 * will need attention, `default` is a healthy state that is not an
 * emergency, `secondary` is inert.
 */

import type { VariantProps } from 'class-variance-authority';
import type { badgeVariants } from '@/components/ui/badge';

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

/**
 * `organizations.status` — only `active` is healthy. `suspended` is an
 * operator action in force, so it reads as danger rather than a grey
 * state: someone deliberately stopped this account.
 */
export function orgStatusTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'secondary';
  if (status === 'active') return 'default';
  if (status === 'suspended') return 'destructive';
  return 'secondary';
}

/**
 * `subscriptions.status`. `past_due` is a warning, not a failure: D17
 * renewals are manual, so a customer mid-transfer sits here legitimately
 * for a day or two and should not be painted red. `canceled` and `unpaid`
 * are the states that have actually stopped service.
 */
export function subStatusTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'secondary';
  if (status === 'active') return 'default';
  if (status === 'trialing') return 'secondary';
  if (status === 'past_due' || status === 'paused') return 'outline';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete') {
    return 'destructive';
  }
  return 'secondary';
}

/**
 * `entitlements.status` — does the gateway agree with the database?
 * `none` (no row) is not a failure: a brand-new account has nothing to
 * push. Only `failed` means an action did not land.
 */
export function entitlementTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'secondary';
  if (status === 'synced') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'pending') return 'outline';
  return 'secondary';
}

/**
 * `payments_d17.status`. `rejected` is amber-adjacent: the customer may
 * still resubmit once, so it is a stall rather than a loss. `paid` is the
 * only settled state.
 */
export function paymentTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'secondary';
  if (status === 'paid') return 'default';
  if (status === 'proof_submitted') return 'outline';
  if (status === 'rejected' || status === 'expired') return 'destructive';
  return 'secondary';
}

/** A plan or key that has been turned off keeps a neutral, not alarmist, look. */
export function retiredTone(retired: boolean): BadgeTone {
  return retired ? 'secondary' : 'default';
}

/**
 * D17 amounts flash a warning when they are still open — the operator's
 * queue is "money claimed but not yet verified".
 */
export function amountTone(cents: number): string {
  if (cents < 0) return 'text-destructive';
  return 'text-emerald-600 dark:text-emerald-400';
}
