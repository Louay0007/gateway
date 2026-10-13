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

/** Budget shape used by the resolver — the three columns it reads. */
export interface BudgetColumns {
  includedSpendCents: number;
  hardCapCents: number | null;
  /** e.g. 13000 for 1.30×. Required since 0007: the gateway budget is
   * denominated in UPSTREAM dollars (LiteLLM tracks row.spend), while
   * hard/included caps are CUSTOMER cents (what the customer agreed to).
   * Omitting it would over-grant by the multiplier. */
  rateMultiplierBps: number;
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
 * Resolve an org's spend ceiling, in UPSTREAM USD for the gateway.
 *
 * Denomination is the whole subject — get it wrong and the cap is fiction:
 *
 *   - `hardCapCents` / `includedSpendCents` are CUSTOMER cents (what the
 *     plan promises: "$100 hard cap", "$20 included").
 *   - LiteLLM's `max_budget` tracks UPSTREAM spend (`row.spend`, what the
 *     provider charged us), not customer cost.
 *   - Customer cost = upstream × multiplier (collect-usage.ts, the margin).
 *
 * So a $100 customer cap at 1.30× is $76.92 upstream. Returning $100
 * directly would let the customer spend $130 before the cutoff — the
 * exact overshoot this function exists to prevent.
 *
 * Rules, in order:
 *   1. A cut always wins → CUT_BUDGET.
 *   2. Use the hard cap if the plan has one, converted to upstream.
 *   3. Otherwise use the included allowance, converted the same way.
 *   4. If the result is zero, return CUT_BUDGET — never 0.
 *
 * OVERAGE (`overage_markup_bps`) is deliberately NOT a second multiplier
 * here. Customer cost is upstream × rate_multiplier for EVERY row,
 * included or over. `overage_markup_bps` must equal
 * `rate_multiplier_bps - 10000` (30% → 3000bps → 1.30×, matching the
 * 13000 multiplier); it is the same margin in the other unit, kept for
 * display and for the day overage gets its own price. Applying both would
 * bill Starter overage at 1.30 × 1.30. Enforced by test, not by hope.
 */
export function resolveBudgetUsd(plan: BudgetColumns, effect: Effect): number {
  if (effect === 'cut') return CUT_BUDGET;

  const m = plan.rateMultiplierBps > 0 ? plan.rateMultiplierBps / 10000 : 1;
  const capCents = plan.hardCapCents ?? plan.includedSpendCents;
  const usdCustomer = capCents / 100;
  const usdUpstream = usdCustomer / m;
  return usdUpstream > 0 ? usdUpstream : CUT_BUDGET;
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
    rateMultiplierBps: number;
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
    {
      includedSpendCents: plan.includedSpendCents,
      hardCapCents: plan.hardCapCents,
      rateMultiplierBps: plan.rateMultiplierBps,
    },
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