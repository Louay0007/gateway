/**
 * Entitlement POLICY — pure functions, zero infrastructure.
 *
 * Separated from sync.ts deliberately. This file decides *what the limits
 * should be*; sync.ts decides *how to push them*. Keeping policy free of
 * the database means the rules that protect money can be unit-tested
 * without Postgres, a gateway, or an upstream key — which is exactly when
 * you most want to test them.
 *
 * No import from db/ or the LiteLLM client appears here, on purpose: a
 * policy module that can be imported anywhere can be verified anywhere.
 */

/** Budget shape used by the resolver — the two columns it reads. */
export interface BudgetColumns {
  includedSpendCents: number;
  hardCapCents: number | null;
}

/**
 * Smallest budget that reliably trips LiteLLM's limiter.
 *
 * MUST be > 0. LiteLLM reads a limit of 0 as "unlimited"
 * (BLUEPRINT.md §9.4) — so writing 0 does not deny access, it GRANTS
 * unlimited access. Every cut and every zero-allowance path funnels here.
 */
export const CUT_BUDGET = 0.000001;

export type Effect = 'full' | 'cut';

/**
 * Subscription status → effect.
 *
 * `past_due` is 'full' on purpose. Stripe retries failed payments for
 * days; cutting on the first `invoice.payment_failed` means a customer who
 * mistyped a card loses service. We cut on `unpaid`, which Stripe assigns
 * only after retries are exhausted (PLATFORM.md §5.1).
 *
 * `paused` is 'cut' but not revoked, so resuming is one webhook rather
 * than a support ticket and a new key.
 */
export const STATUS_EFFECT: Record<string, Effect> = {
  trialing:   'full',
  active:     'full',
  past_due:   'full',
  unpaid:     'cut',
  canceled:   'cut',
  paused:     'cut',
  incomplete: 'cut',
};

export function effectForStatus(status: string): Effect {
  return STATUS_EFFECT[status] ?? 'cut';
}

/**
 * Resolve an org's spend ceiling, in USD.
 *
 * Rules, in order:
 *   1. A cut always wins → CUT_BUDGET.
 *   2. Use the hard cap if the plan has one; that is the ceiling the
 *      customer agreed to.
 *   3. Otherwise use the included allowance as the ceiling.
 *   4. If the result is zero (free plan, or an unset allowance), return
 *      CUT_BUDGET — never 0. PLATFORM.md §9.1: "A free signup must not be
 *      able to spend your money."
 */
export function resolveBudgetUsd(plan: BudgetColumns, effect: Effect): number {
  if (effect === 'cut') return CUT_BUDGET;

  const capCents = plan.hardCapCents ?? plan.includedSpendCents;
  const usd = capCents / 100;
  return usd > 0 ? usd : CUT_BUDGET;
}

/**
 * Resolve the LiteLLM limit fields for an entitlement.
 *
 * A cut org keeps its keys alive (so reactivating is instant) but loses
 * every capability: empty model allowlist means no model is reachable, and
 * null rate limits fall back to the router default rather than a number
 * we would then have to unwind.
 */
export function resolveLimits(
  plan: {
    rpmLimit: number | null;
    tpmLimit: number | null;
    maxConcurrentRequests: number | null;
    models: string[];
    includedSpendCents: number;
    hardCapCents: number | null;
  },
  effect: Effect,
): {
  models: string[];
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null;
  maxBudgetUsd: number;
} {
  const maxBudgetUsd = resolveBudgetUsd(
    { includedSpendCents: plan.includedSpendCents, hardCapCents: plan.hardCapCents },
    effect,
  );

  if (effect === 'cut') {
    return { models: [], rpm: null, tpm: null, concurrency: null, maxBudgetUsd };
  }
  return {
    models: plan.models,
    rpm: plan.rpmLimit,
    tpm: plan.tpmLimit,
    concurrency: plan.maxConcurrentRequests,
    maxBudgetUsd,
  };
}