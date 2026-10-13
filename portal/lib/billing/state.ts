/**
 * Billing state vocabulary — pure, zero infrastructure.
 *
 * Split out of service.ts on purpose, for the same reason
 * lib/entitlements/policy.ts is separate from sync.ts: the rules that
 * decide what a payment means must be testable without Postgres.
 * Importing service.ts pulls in `db`, which throws outside a configured
 * environment; this file imports nothing but a type.
 */

/** What the dashboard shows, in customer language. */
export type PlanState =
  | 'no_subscription'
  | 'pending'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'paused';

/**
 * Internal row states → customer-facing states.
 *
 * `incomplete` is "payment never completed" — what the dashboard calls
 * `pending`. `trialing` maps to active defensively: no plan carries
 * trial days in the MVP, so the value should never appear; if one ever
 * does, full access is the intended reading (PLATFORM.md §5.1), and a
 * broken-looking state on a paid account is worse than the alias.
 */
export function planStateFromStatus(status: string): PlanState {
  if (status === 'incomplete') return 'pending';
  if (status === 'trialing') return 'active';
  return status as PlanState;
}

/** The subset of a plan row that is safe to show a customer. */
export interface PlanSummary {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: string;
  includedSpendCents: number;
  hardCapCents: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxConcurrentRequests: number | null;
  maxKeys: number;
  rateMultiplierBps: number;
  models: string[];
}

/** Project a plan row onto the customer-safe shape. */
export function summarizePlan(row: {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: string;
  includedSpendCents: number;
  hardCapCents: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxConcurrentRequests: number | null;
  maxKeys: number;
  rateMultiplierBps: number;
  models: string[];
}): PlanSummary {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    interval: row.interval,
    includedSpendCents: row.includedSpendCents,
    hardCapCents: row.hardCapCents,
    rpmLimit: row.rpmLimit,
    tpmLimit: row.tpmLimit,
    maxConcurrentRequests: row.maxConcurrentRequests,
    maxKeys: row.maxKeys,
    rateMultiplierBps: row.rateMultiplierBps,
    models: row.models,
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Errors — the same vocabulary the API envelope speaks
// ───────────────────────────────────────────────────────────────────────

export type BillingErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'upstream'
  | 'internal'
  | 'payment_required';

const ERROR_STATUS: Record<BillingErrorCode, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  upstream: 502,
  internal: 500,
  payment_required: 402,
};

export class BillingError extends Error {
  constructor(readonly code: BillingErrorCode, message: string) {
    super(message);
    this.name = 'BillingError';
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}
