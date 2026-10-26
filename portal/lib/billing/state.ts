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
 * `pending`.
 *
 * `trialing` is a LIVE status again (free trial codes, migration 0017:
 * redeem → `subscriptions.status = 'trialing'` → full access for the
 * window). The client vocabulary has no `trialing` branch and the intended
 * reading of a trial is full access (PLATFORM.md §5.1), so it maps to
 * `active`; casting it straight through would hand the dashboard a state
 * it cannot render.
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
  /** Per-alias blended-token budgets (raw tokens). Migration 0023. */
  tokenLimits: Record<string, number>;
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
  tokenLimits?: Record<string, number> | unknown;
}): PlanSummary {
  // JSONB columns arrive as `unknown` from Drizzle. Cast safely — a
  // malformed token value defaults to empty = UNLIMITED for that alias
  // (see quota.ts TOKEN WALL note), never Infinity from a bad number.
  const rawTok = row.tokenLimits;
  const tokenLimits: Record<string, number> = {};
  if (rawTok && typeof rawTok === 'object' && !Array.isArray(rawTok)) {
    for (const [k, v] of Object.entries(rawTok as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        tokenLimits[k] = v;
      }
    }
  }

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
    tokenLimits,
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Errors — the same vocabulary the API envelope speaks
// ───────────────────────────────────────────────────────────────────────

export type BillingErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'upstream'
  | 'internal'
  | 'payment_required';

const ERROR_STATUS: Record<BillingErrorCode, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
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
