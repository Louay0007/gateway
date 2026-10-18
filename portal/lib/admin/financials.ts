/**
 * Admin financials — what the business actually made.
 *
 * WHY BOTH COST COLUMNS EXIST. `usage_records` stores
 * `cost_upstream_usd` and `cost_customer_usd` on every row rather than
 * deriving one from the other, and schema.ts says why: "Both columns
 * stored deliberately: the gap IS the margin and storing one makes the
 * business invisible." Nothing read that gap until now — `rate_multiplier_bps`
 * (13000 for Starter, 12500 for Pro) was applied to rows and never once
 * summed. So the single most important number this product produces had
 * no screen.
 *
 * FOUR DIFFERENT NUMBERS, KEPT SEPARATE ON PURPOSE. Conflating them is
 * the error this module exists to prevent:
 *
 *   collected     — money that actually arrived (a D17 transfer verified).
 *   recognised    — subscriptions that are live right now (plan price).
 *   usage revenue — metered customer spend in the window.
 *   upstream cost — what those tokens cost the provider.
 *
 * They are NOT equal and never reconcile to equality in a given window:
 * D17 payment timing, trials that consume spend without revenue,
 * and the window boundary all make them diverge legitimately. The
 * divergence is the point. Hiding it behind one "revenue" number is how
 * a business ends up unable to explain a bank balance.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface FinancialSummary {
  windowDays: number;
  /** Money that arrived, in USD, from verified D17 payments. */
  collectedUsd: number;
  /** Verified transfers in the window. */
  collectedCount: number;
  /** Credit notes in the window. Signed: negative refunded, positive credited. */
  creditsUsd: number;
  creditsTnd: number;
  creditsCount: number;
  /** Metered customer spend in the window. */
  usageRevenueUsd: number;
  /** Provider cost for that same spend. */
  upstreamCostUsd: number;
  /** usageRevenue - upstreamCost. The per-token margin. */
  grossMarginUsd: number;
  /** grossMargin as a share of usageRevenue, or null when there is no revenue. */
  grossMarginPct: number | null;
  /** Effective multiplier actually realised, bps. 13000 = 1.30x. */
  effectiveRateBps: number | null;
  requests: number;
  promptCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * Headline financials over a trailing window.
 *
 * `grossMarginPct` and `effectiveRateBps` are NULL rather than 0 when
 * there is no revenue: "no revenue" and "zero percent margin" are
 * different facts, and rendering the second where the first is true is
 * how a dashboard teaches an operator to ignore it.
 */
export async function financialSummary(
  windowDays = 30,
): Promise<FinancialSummary> {
  const days = clampDays(windowDays);

  const [usage] = (await db.execute(sql`
    SELECT COALESCE(sum(ur.cost_customer_usd), 0)::float8 AS usage_revenue,
           COALESCE(sum(ur.cost_upstream_usd), 0)::float8 AS upstream_cost,
           count(*)::bigint                              AS requests,
           COALESCE(sum(ur.prompt_count), 0)::bigint      AS prompts,
           COALESCE(sum(ur.input_tokens), 0)::bigint     AS input_tokens,
           COALESCE(sum(ur.output_tokens), 0)::bigint    AS output_tokens,
           COALESCE(sum(ur.cache_read_tokens), 0)::bigint AS cache_read_tokens
      FROM usage_records ur
     WHERE ur.occurred_at > now() - (${days} * interval '1 day')
  `)) as unknown as {
    usage_revenue: number;
    upstream_cost: number;
    requests: string;
    prompts: string;
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens: string;
  }[];

  const [payments] = (await db.execute(sql`
    SELECT COALESCE(sum(p.usd_amount_cents), 0)::float8 / 100 AS collected_usd,
           count(*)::int                                       AS collected_count
      FROM payments_d17 p
     WHERE p.status = 'paid'
       AND p.verified_at > now() - (${days} * interval '1 day')
  `)) as unknown as { collected_usd: number; collected_count: number }[];

  const [credits] = (await db.execute(sql`
    SELECT COALESCE(sum(c.amount_cents) FILTER (WHERE c.currency = 'USD'), 0)::float8 / 100
             AS credits_usd,
           COALESCE(sum(c.amount_cents) FILTER (WHERE c.currency = 'TND'), 0)::float8 / 100
             AS credits_tnd,
           count(*)::int AS credits_count
      FROM credit_notes c
     WHERE c.created_at > now() - (${days} * interval '1 day')
  `)) as unknown as {
    credits_usd: number;
    credits_tnd: number;
    credits_count: number;
  }[];

  const usageRevenue = Number(usage?.usage_revenue ?? 0);
  const upstreamCost = Number(usage?.upstream_cost ?? 0);
  const grossMargin = usageRevenue - upstreamCost;

  return {
    windowDays: days,
    collectedUsd: Number(payments?.collected_usd ?? 0),
    collectedCount: Number(payments?.collected_count ?? 0),
    creditsUsd: Number(credits?.credits_usd ?? 0),
    creditsTnd: Number(credits?.credits_tnd ?? 0),
    creditsCount: Number(credits?.credits_count ?? 0),
    usageRevenueUsd: usageRevenue,
    upstreamCostUsd: upstreamCost,
    grossMarginUsd: grossMargin,
    grossMarginPct:
      usageRevenue > 0 ? (grossMargin / usageRevenue) * 100 : null,
    effectiveRateBps:
      upstreamCost > 0
        ? Math.round((usageRevenue / upstreamCost) * 10000)
        : null,
    requests: Number(usage?.requests ?? 0),
    promptCount: Number(usage?.prompts ?? 0),
    inputTokens: Number(usage?.input_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? 0),
    cacheReadTokens: Number(usage?.cache_read_tokens ?? 0),
  };
}

export interface DailyFinancial {
  day: string;
  collectedUsd: number;
  usageRevenueUsd: number;
  upstreamCostUsd: number;
  grossMarginUsd: number;
  requests: number;
}

/**
 * Daily series for the revenue/margin chart.
 *
 * Two independent sources are combined with a FULL OUTER JOIN so a day
 * with no payments still plots its usage, and a day with no usage still
 * plots its collection. An inner join would silently drop days from
 * whichever series was sparser, and the chart would show revenue
 * vanishing on days the bank received money.
 */
export async function financialSeries(
  windowDays = 30,
): Promise<DailyFinancial[]> {
  const days = clampDays(windowDays);

  const rows = (await db.execute(sql`
    WITH d AS (
      SELECT generate_series(
        (now() - (${days} * interval '1 day'))::date,
        now()::date,
        interval '1 day'
      )::date AS day
    ),
    usage AS (
      SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
             sum(cost_customer_usd)::float8 AS revenue,
             sum(cost_upstream_usd)::float8   AS upstream,
             count(*)::int                    AS requests
        FROM usage_records
       WHERE occurred_at > now() - (${days} * interval '1 day')
       GROUP BY 1
    ),
    collected AS (
      SELECT (verified_at AT TIME ZONE 'UTC')::date AS day,
             sum(usd_amount_cents)::float8 / 100 AS collected_usd
        FROM payments_d17
       WHERE status = 'paid'
         AND verified_at > now() - (${days} * interval '1 day')
       GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(c.collected_usd, 0)::float8 AS collected_usd,
           COALESCE(u.revenue, 0)::float8       AS usage_revenue_usd,
           COALESCE(u.upstream, 0)::float8      AS upstream_cost_usd,
           COALESCE(u.requests, 0)::int         AS requests
      FROM d
      LEFT JOIN usage u ON u.day = d.day
      LEFT JOIN collected c ON c.day = d.day
     ORDER BY d.day ASC
  `)) as unknown as {
    day: string;
    collected_usd: number;
    usage_revenue_usd: number;
    upstream_cost_usd: number;
    requests: number;
  }[];

  return rows.map((r) => ({
    day: r.day,
    collectedUsd: Number(r.collected_usd),
    usageRevenueUsd: Number(r.usage_revenue_usd),
    upstreamCostUsd: Number(r.upstream_cost_usd),
    grossMarginUsd: Number(r.usage_revenue_usd) - Number(r.upstream_cost_usd),
    requests: Number(r.requests),
  }));
}

// ───────────────────────────────────────────────────────────────────────
//  Subscription base
// ───────────────────────────────────────────────────────────────────────

export interface MrrRow {
  planCode: string;
  status: string;
  count: number;
  /** Monthly-equivalent recognised revenue in USD. */
  mrrUsd: number;
}

/**
 * MRR by plan and status.
 *
 * `trialing` is reported SEPARATELY and not counted as revenue: a trial
 * consumes the plan's full included spend (`STATUS_EFFECT.trialing =
 * 'full'`) while generating none, so folding it into MRR would overstate
 * revenue and understate cost. Annual plans are divided by 12 so a
 * single number compares across intervals.
 */
export async function mrrByPlan(): Promise<{
  rows: MrrRow[];
  activeMrrUsd: number;
  trialingCount: number;
  pastDueCount: number;
  unpaidCount: number;
}> {
  const rows = (await db.execute(sql`
    SELECT p.code AS plan_code, s.status::text AS status,
           count(*)::int AS n,
           sum(CASE WHEN p.interval = 'year' THEN p.price_cents / 12.0
                    ELSE p.price_cents END)::float8 / 100 AS mrr_usd
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.status IN ('active', 'trialing', 'past_due', 'unpaid')
     GROUP BY 1, 2
     ORDER BY 1, 2
  `)) as unknown as {
    plan_code: string;
    status: string;
    n: number;
    mrr_usd: number;
  }[];

  const mapped: MrrRow[] = rows.map((r) => ({
    planCode: r.plan_code,
    status: r.status,
    count: Number(r.n),
    mrrUsd: Number(r.mrr_usd),
  }));

  const sum = (status: string) =>
    mapped
      .filter((r) => r.status === status)
      .reduce((acc, r) => acc + r.mrrUsd, 0);
  const count = (status: string) =>
    mapped
      .filter((r) => r.status === status)
      .reduce((acc, r) => acc + r.count, 0);

  // Only `active` is revenue. A past_due or unpaid subscription is
  // deliberately NOT counted — it has been cut at the gateway
  // (CUT_BUDGET), so counting it would book revenue for access the
  // customer cannot use.
  return {
    rows: mapped,
    activeMrrUsd: sum('active'),
    trialingCount: count('trialing'),
    pastDueCount: count('past_due'),
    unpaidCount: count('unpaid'),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Org-level economics
// ───────────────────────────────────────────────────────────────────────

export interface OrgEconomicsRow {
  id: string;
  name: string;
  slug: string;
  planCode: string | null;
  status: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageRevenueUsd: number;
  upstreamCostUsd: number;
  grossMarginUsd: number;
}

/**
 * Per-org economics, biggest spender first.
 *
 * Answers the question `usageHistory` structurally cannot: that one is
 * scoped to the CALLER's org (`requireActiveOrg`), so "who is burning
 * money on `frontier`?" had no route at all. Ordering by customer
 * revenue rather than by request count is deliberate — an org making
 * 10,000 cheap requests is less interesting than one making 200
 * expensive ones, and only the revenue sort makes that visible.
 */
export async function orgEconomics(
  windowDays = 30,
  limit = 50,
): Promise<OrgEconomicsRow[]> {
  const days = clampDays(windowDays);
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));

  const rows = (await db.execute(sql`
    SELECT o.id::text, o.name, o.slug, o.status::text AS status,
           p.code AS plan_code,
           count(ur.id)::int                            AS requests,
           COALESCE(sum(ur.input_tokens), 0)::bigint     AS input_tokens,
           COALESCE(sum(ur.output_tokens), 0)::bigint    AS output_tokens,
           COALESCE(sum(ur.cache_read_tokens), 0)::bigint AS cache_read_tokens,
           COALESCE(sum(ur.cost_customer_usd), 0)::float8 AS revenue,
           COALESCE(sum(ur.cost_upstream_usd), 0)::float8  AS upstream
      FROM usage_records ur
      JOIN organizations o ON o.id = ur.organization_id
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
     WHERE ur.occurred_at > now() - (${days} * interval '1 day')
       AND o.status <> 'deleted'
     GROUP BY o.id, o.name, o.slug, o.status, p.code
     ORDER BY revenue DESC
     LIMIT ${capped}
  `)) as unknown as {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_code: string | null;
    requests: number;
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens: string;
    revenue: number;
    upstream: number;
  }[];

  return rows.map((r) => {
    const revenue = Number(r.revenue);
    const upstream = Number(r.upstream);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      planCode: r.plan_code,
      status: r.status,
      requests: Number(r.requests),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      usageRevenueUsd: revenue,
      upstreamCostUsd: upstream,
      grossMarginUsd: revenue - upstream,
    };
  });
}

/** Cap the window: the chart's own series helper 400s past 1000 points. */
function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(1, Math.floor(n)));
}