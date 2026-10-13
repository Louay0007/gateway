import type { PlanState, PlanSummary } from "@/lib/billing/state";
import type { KeyView } from "@/lib/keys/types";
import type { UsageRowView } from "@/lib/billing/service";

/**
 * The shapes the dashboard's client components receive.
 *
 * Declared HERE rather than imported from each route so a contract change
 * breaks the build once, in one file, instead of producing a component
 * that silently reads a field the server renamed. Each mirrors the route
 * that produces it:
 *
 *   SubscriptionBundle ← GET  /api/subscription   (lib/billing/service.ts)
 *   UsagePageResponse  ← GET  /api/usage         (UsageRowView, above)
 *   OrgListItem        ← GET  /api/orgs
 *   KeyView            ← GET  /api/keys          (lib/keys/types.ts)
 *
 * `subscriptionBundle` builds its usage numbers from the LEDGER, not the
 * rollup cache (PLATFORM §8.2) — the rollup is a chart accelerator, never
 * the source of a number a customer is shown.
 */

export interface SubscriptionBundle {
  state: PlanState;
  plan: PlanSummary | null;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  entitlement: {
    status: string;
    syncedAt: string | null;
    lastError: string | null;
  } | null;
  period: { start: string; end: string };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUpstreamUsd: number;
    costCustomerUsd: number;
  };
  limits: PlanSummary | null;
  keys: { active: number; max: number | null };
}

export interface UsagePageResponse {
  rows: UsageRowView[];
  total: number;
  page: number;
  pageSize: number;
  /** Aggregates over the same filter as `rows`. */
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costCustomerUsd: number;
    costUpstreamUsd: number;
  };
}

export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
}

export interface PublicPlan extends PlanSummary {
  public?: boolean;
  sortOrder?: number;
}

/** One row of `GET /api/billing/payments`. */
export interface PaymentHistoryItem {
  id: string;
  planCode: string;
  planName: string;
  /** TND millimes — what the customer actually transferred. */
  amountMillimes: number;
  /** Same figure, formatted ("58.900"). */
  amount: string;
  usdAmountCents: number;
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  expiresAt: string;
  rejectReason: string | null;
  flaggedReview: boolean;
}

export interface PaymentHistoryResponse {
  payments: PaymentHistoryItem[];
}

export type { KeyView, UsageRowView };

/** The plan catalog row as `/api/plans` returns it. */
export type PlanListResponse = { plans: PublicPlan[] };