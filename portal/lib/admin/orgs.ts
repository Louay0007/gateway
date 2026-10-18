/**
 * Admin org queries — the READ side of the operations console.
 *
 * `lib/billing/admin-console.ts` holds the money-MOVING powers (suspend,
 * reactivate, retry, credit). This file holds the ones that only look:
 * a filterable roster, and the single-org drill-down an operator opens
 * when a customer says "your numbers are wrong".
 *
 * Why raw SQL and not the drizzle query builder: every query here is a
 * grouped aggregate or a filtered roster over tables whose rows are
 * counted in the thousands, and three of them join a `usage_records`
 * subquery that drizzle's 0.38 builder cannot express without a lateral
 * join. The rule the codebase already follows (CONTEXT.md §11) applies:
 * `db.execute` returns SNAKE_CASE keys, so every read below coerces
 * explicitly. Reading a camelCase name off a raw row yields `undefined`,
 * which parses as `NaN` and renders as a plausible wrong number rather
 * than an error.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';

// ───────────────────────────────────────────────────────────────────────
//  Roster
// ───────────────────────────────────────────────────────────────────────

export interface AdminOrgFilters {
  /** Free text over name and slug. */
  q?: string;
  status?: 'active' | 'suspended' | 'deleted';
  planCode?: string;
  /** Only orgs whose gateway push is failing. */
  entitlementFailed?: boolean;
  /** Only orgs over their plan's hard cap this period. */
  overCapOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  planCode: string | null;
  subStatus: string | null;
  currentPeriodEnd: string | null;
  entitlementStatus: string | null;
  entitlementError: string | null;
  /** Customer dollars spent in the current subscription period. */
  periodCostUsd: number;
  /** Upstream dollars for the same window — the margin is the gap. */
  periodCostUpstreamUsd: number;
  hardCapCents: number | null;
  keyCount: number;
  createdAt: string;
}

export interface AdminOrgPage {
  rows: AdminOrgRow[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;

/**
 * The org roster, filtered and paginated.
 *
 * `total` is counted over the SAME WHERE as `rows`, so "142 accounts
 * match" is a fact about the database rather than an artifact of which
 * page arrived. Both cost columns come from the same subquery so the
 * per-row margin is computed over one scan.
 */
export async function listAdminOrgsFiltered(
  filters: AdminOrgFilters = {},
): Promise<AdminOrgPage> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(filters.pageSize ?? 25)),
  );
  const offset = (page - 1) * pageSize;

  const q = filters.q?.trim();
  // A LIKE pattern is a parameter, never concatenation. `%` and `_` from
  // a user are escaped so a search for "100%" does not become a wildcard
  // that matches everything.
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  const rows = (await db.execute(sql`
    SELECT o.id::text, o.name, o.slug, o.status::text AS status,
           o.created_at,
           p.code AS plan_code, p.hard_cap_cents,
           s.status::text AS sub_status, s.current_period_end,
           e.status::text AS entitlement_status, e.last_error AS entitlement_error,
           COALESCE(u.period_cost, 0)::float8      AS period_cost_usd,
           COALESCE(u.period_cost_upstream, 0)::float8 AS period_cost_upstream_usd,
           (SELECT count(*) FROM api_keys k
             WHERE k.organization_id = o.id AND k.revoked_at IS NULL)::int AS key_count
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN entitlements e ON e.organization_id = o.id
      LEFT JOIN LATERAL (
            SELECT sum(ur.cost_customer_usd) AS period_cost,
                   sum(ur.cost_upstream_usd) AS period_cost_upstream
              FROM usage_records ur
             WHERE ur.organization_id = o.id
               AND ur.occurred_at >= COALESCE(
                     s.current_period_start, date_trunc('month', now()))
        ) u ON TRUE
     WHERE o.status <> 'deleted'
       ${filters.status ? sql`AND o.status = ${filters.status}::org_status` : sql``}
       ${planCodeFilter(filters.planCode)}
       ${filters.entitlementFailed ? sql`AND e.status = 'failed'` : sql``}
       ${like ? sql`AND (o.name ILIKE ${like} OR o.slug ILIKE ${like})` : sql``}
     ORDER BY o.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as RawOrgRow[];

  // The count repeats the WHERE but not the LATERAL join — counting does
  // not need per-row spend, and skipping it keeps this off the ledger.
  const counted = (await db.execute(sql`
    SELECT count(*)::int AS n
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN entitlements e ON e.organization_id = o.id
     WHERE o.status <> 'deleted'
       ${filters.status ? sql`AND o.status = ${filters.status}::org_status` : sql``}
       ${planCodeFilter(filters.planCode)}
       ${filters.entitlementFailed ? sql`AND e.status = 'failed'` : sql``}
       ${like ? sql`AND (o.name ILIKE ${like} OR o.slug ILIKE ${like})` : sql``}
  `)) as unknown as { n: number }[];

  const total = Number(counted[0]?.n ?? 0);

  // `over_cap_only` cannot be a WHERE clause without recomputing the
  // period spend in a second lateral, so it is applied to the page and
  // the total is recomputed from the full filtered set. Filtering after
  // the LIMIT would silently under-report, which is the exact class of
  // bug the "summary cards must not disagree with the table" rule exists
  // to prevent — so this branch re-queries without the limit instead.
  if (filters.overCapOnly) {
    return listOverCap(filters, page, pageSize, like);
  }

  return {
    rows: rows.map(toAdminOrgRow),
    total,
    page,
    pageSize,
  };
}

interface RawOrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date | string;
  plan_code: string | null;
  hard_cap_cents: number | null;
  sub_status: string | null;
  current_period_end: Date | string | null;
  entitlement_status: string | null;
  entitlement_error: string | null;
  period_cost_usd: number;
  period_cost_upstream_usd: number;
  key_count: number;
}

/**
 * `over_cap_only` — the one filter that needs the spend subquery in the
 * WHERE, because "over cap" is a comparison against a computed number
 * rather than a column. Kept separate so the common path stays a single
 * lateral join.
 */
async function listOverCap(
  filters: AdminOrgFilters,
  page: number,
  pageSize: number,
  like: string | null,
): Promise<AdminOrgPage> {
  const offset = (page - 1) * pageSize;

  const all = (await db.execute(sql`
    SELECT o.id::text, o.name, o.slug, o.status::text AS status,
           o.created_at,
           p.code AS plan_code, p.hard_cap_cents,
           s.status::text AS sub_status, s.current_period_end,
           e.status::text AS entitlement_status, e.last_error AS entitlement_error,
           COALESCE(u.period_cost, 0)::float8 AS period_cost_usd,
           COALESCE(u.period_cost_upstream, 0)::float8 AS period_cost_upstream_usd,
           (SELECT count(*) FROM api_keys k
             WHERE k.organization_id = o.id AND k.revoked_at IS NULL)::int AS key_count
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN entitlements e ON e.organization_id = o.id
      LEFT JOIN LATERAL (
            SELECT sum(ur.cost_customer_usd) AS period_cost,
                   sum(ur.cost_upstream_usd) AS period_cost_upstream
              FROM usage_records ur
             WHERE ur.organization_id = o.id
               AND ur.occurred_at >= COALESCE(
                     s.current_period_start, date_trunc('month', now()))
        ) u ON TRUE
     WHERE o.status <> 'deleted'
       ${filters.status ? sql`AND o.status = ${filters.status}::org_status` : sql``}
       ${planCodeFilter(filters.planCode)}
       ${filters.entitlementFailed ? sql`AND e.status = 'failed'` : sql``}
       ${like ? sql`AND (o.name ILIKE ${like} OR o.slug ILIKE ${like})` : sql``}
       AND p.hard_cap_cents IS NOT NULL
       AND COALESCE(u.period_cost, 0) * 100 > p.hard_cap_cents
     ORDER BY o.created_at DESC
  `)) as unknown as RawOrgRow[];

  return {
    rows: all.slice(offset, offset + pageSize).map(toAdminOrgRow),
    total: all.length,
    page,
    pageSize,
  };
}

/** Plan codes come from a finite catalog; still a bound parameter. */
function planCodeFilter(planCode?: string) {
  const code = planCode?.trim();
  return code ? sql`AND p.code = ${code}` : sql``;
}

function toAdminOrgRow(r: RawOrgRow): AdminOrgRow {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    // postgres.js hands back a native timestamptz as a STRING. Coerce
    // here or the page throws on `.toISOString()` — the proof caught
    // exactly this once already (admin-console.ts).
    createdAt: new Date(r.created_at).toISOString(),
    planCode: r.plan_code,
    subStatus: r.sub_status,
    currentPeriodEnd:
      r.current_period_end == null
        ? null
        : new Date(r.current_period_end).toISOString(),
    entitlementStatus: r.entitlement_status,
    entitlementError: r.entitlement_error,
    periodCostUsd: Number(r.period_cost_usd),
    periodCostUpstreamUsd: Number(r.period_cost_upstream_usd),
    hardCapCents: r.hard_cap_cents == null ? null : Number(r.hard_cap_cents),
    keyCount: Number(r.key_count),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Drill-down
// ───────────────────────────────────────────────────────────────────────

export interface AdminOrgDetail {
  org: AdminOrgRow;
  members: AdminOrgMember[];
  keys: AdminOrgKey[];
  subscriptions: AdminOrgSubscription[];
  credits: AdminOrgCredit[];
  payments: AdminOrgPayment[];
  recentAudit: AdminAuditRow[];
}

export interface AdminOrgMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

export interface AdminOrgKey {
  id: string;
  name: string;
  keyPrefix: string;
  kind: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AdminOrgSubscription {
  id: string;
  planCode: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

/**
 * Everything about one org, in parallel.
 *
 * `Promise.all` rather than five sequential awaits: these are five
 * independent reads and the drill-down is on the critical path of an
 * operator answering a customer who is waiting on the phone.
 *
 * The org lookup REJECTS deleted orgs. A soft-deleted org keeps its
 * ledger (it is the billing record) but must not appear in the console,
 * or "suspended" and "deleted" become indistinguishable to an operator.
 */
export async function adminOrgDetail(orgId: string): Promise<AdminOrgDetail | null> {
  const [orgPage, members, keys, subs, credits, payments, audit] = await Promise.all([
    orgById(orgId),
    listOrgMembers(orgId),
    listOrgKeys(orgId),
    listOrgSubscriptions(orgId),
    listOrgCredits(orgId),
    listOrgPayments(orgId),
    listAudit({ organizationId: orgId, pageSize: 25 }),
  ]);

  if (!orgPage) return null;

  return {
    org: orgPage,
    members,
    keys,
    subscriptions: subs,
    credits,
    payments,
    recentAudit: audit.rows,
  };
}

async function orgById(orgId: string): Promise<AdminOrgRow | null> {
  const rows = (await db.execute(sql`
    SELECT o.id::text, o.name, o.slug, o.status::text AS status, o.created_at,
           p.code AS plan_code, p.hard_cap_cents,
           s.status::text AS sub_status, s.current_period_end,
           e.status::text AS entitlement_status, e.last_error AS entitlement_error,
           COALESCE(u.period_cost, 0)::float8 AS period_cost_usd,
           COALESCE(u.period_cost_upstream, 0)::float8 AS period_cost_upstream_usd,
           (SELECT count(*) FROM api_keys k
             WHERE k.organization_id = o.id AND k.revoked_at IS NULL)::int AS key_count
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN entitlements e ON e.organization_id = o.id
      LEFT JOIN LATERAL (
            SELECT sum(ur.cost_customer_usd) AS period_cost,
                   sum(ur.cost_upstream_usd) AS period_cost_upstream
              FROM usage_records ur
             WHERE ur.organization_id = o.id
               AND ur.occurred_at >= COALESCE(
                     s.current_period_start, date_trunc('month', now()))
        ) u ON TRUE
     WHERE o.id = ${orgId}::uuid AND o.status <> 'deleted'
  `)) as unknown as RawOrgRow[];
  return rows[0] ? toAdminOrgRow(rows[0]) : null;
}

async function listOrgMembers(orgId: string): Promise<AdminOrgMember[]> {
  const rows = (await db.execute(sql`
    SELECT m.user_id::text, u.email, u.name, m.role::text AS role, m.created_at
      FROM organization_members m
      JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ${orgId}::uuid
     ORDER BY m.created_at ASC
  `)) as unknown as {
    user_id: string;
    email: string;
    name: string | null;
    role: string;
    created_at: Date | string;
  }[];

  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

async function listOrgKeys(orgId: string): Promise<AdminOrgKey[]> {
  const rows = (await db.execute(sql`
    SELECT id::text, name, key_prefix, kind,
           revoked_at, last_used_at, created_at
      FROM api_keys
     WHERE organization_id = ${orgId}::uuid
     ORDER BY created_at DESC
     LIMIT 200
  `)) as unknown as {
    id: string;
    name: string;
    key_prefix: string;
    kind: string;
    revoked_at: Date | string | null;
    last_used_at: Date | string | null;
    created_at: Date | string;
  }[];

  // key_prefix only — the hash is never selected, so it cannot leak
  // through this read even by accident.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    kind: r.kind,
    revokedAt: r.revoked_at == null ? null : new Date(r.revoked_at).toISOString(),
    lastUsedAt:
      r.last_used_at == null ? null : new Date(r.last_used_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

async function listOrgSubscriptions(orgId: string): Promise<AdminOrgSubscription[]> {
  const rows = (await db.execute(sql`
    SELECT s.id::text, p.code AS plan_code, s.status::text AS status,
           s.current_period_start, s.current_period_end,
           s.cancel_at_period_end, s.trial_end
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ${orgId}::uuid
     ORDER BY s.created_at DESC
  `)) as unknown as {
    id: string;
    plan_code: string | null;
    status: string;
    current_period_start: Date | string | null;
    current_period_end: Date | string | null;
    cancel_at_period_end: boolean;
    trial_end: Date | string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    planCode: r.plan_code,
    status: r.status,
    currentPeriodStart: iso(r.current_period_start),
    currentPeriodEnd: iso(r.current_period_end),
    cancelAtPeriodEnd: r.cancel_at_period_end,
    trialEnd: iso(r.trial_end),
  }));
}

async function listOrgCredits(orgId: string): Promise<AdminOrgCredit[]> {
  const rows = (await db.execute(sql`
    SELECT id::text, amount_cents, currency, reason, created_by, created_at
      FROM credit_notes
     WHERE organization_id = ${orgId}::uuid
     ORDER BY created_at DESC
  `)) as unknown as {
    id: string;
    amount_cents: number;
    currency: string;
    reason: string;
    created_by: string;
    created_at: Date | string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

async function listOrgPayments(orgId: string): Promise<AdminOrgPayment[]> {
  const rows = (await db.execute(sql`
    SELECT p.id::text, p.status::text AS status, p.amount_millimes,
           p.currency, p.usd_amount_cents, p.fx_rate,
           p.authorization_number, p.sender_phone,
           p.submitted_at, p.verified_at, p.reject_reason,
           pl.code AS plan_code
      FROM payments_d17 p
      LEFT JOIN subscriptions s ON s.id = p.subscription_id
      LEFT JOIN plans pl ON pl.id = s.plan_id
     WHERE p.organization_id = ${orgId}::uuid
     ORDER BY p.created_at DESC
     LIMIT 200
  `)) as unknown as {
    id: string;
    status: string;
    amount_millimes: number;
    currency: string;
    usd_amount_cents: number;
    fx_rate: string;
    authorization_number: string | null;
    sender_phone: string | null;
    submitted_at: Date | string | null;
    verified_at: Date | string | null;
    reject_reason: string | null;
    plan_code: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    planCode: r.plan_code,
    amountMillimes: Number(r.amount_millimes),
    currency: r.currency,
    usdAmountCents: Number(r.usd_amount_cents),
    fxRate: Number(r.fx_rate),
    authorizationNumber: r.authorization_number,
    senderPhone: r.sender_phone,
    submittedAt: iso(r.submitted_at),
    verifiedAt: iso(r.verified_at),
    rejectReason: r.reject_reason,
  }));
}

function iso(v: Date | string | null): string | null {
  return v == null ? null : new Date(v).toISOString();
}

export interface AdminOrgCredit {
  id: string;
  amountCents: number;
  currency: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface AdminOrgPayment {
  id: string;
  status: string;
  planCode: string | null;
  amountMillimes: number;
  currency: string;
  usdAmountCents: number;
  fxRate: number;
  authorizationNumber: string | null;
  senderPhone: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Audit trail
// ───────────────────────────────────────────────────────────────────────

export interface AdminAuditRow {
  id: number;
  actorType: string;
  actorId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AdminAuditFilters {
  organizationId?: string;
  action?: string;
  actorType?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The audit log, newest first.
 *
 * This is the table every money-moving action already writes and nothing
 * read until now: "who suspended this account on the 12th" was
 * unanswerable from the product. `before`/`after` are returned as raw
 * JSON because their shape is per-action by design — a single projection
 * would have to lie about most of them.
 */
export async function listAudit(
  filters: AdminAuditFilters = {},
): Promise<{ rows: AdminAuditRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(filters.pageSize ?? 50)),
  );
  const offset = (page - 1) * pageSize;

  const action = filters.action?.trim();
  const actorType = filters.actorType?.trim();
  // Prefix match, not equality: `organization.suspended` and
  // `organization.reactivated` share a prefix and an operator filtering
  // "organization." wants both.
  const actionLike = action ? `${action.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  const rows = (await db.execute(sql`
    SELECT a.id, a.actor_type::text AS actor_type, a.actor_id,
           a.organization_id::text AS organization_id, o.name AS organization_name,
           a.action, a.target_type, a.target_id,
           a.before, a.after, a.ip::text AS ip, a.created_at
      FROM audit_log a
      LEFT JOIN organizations o ON o.id = a.organization_id
     WHERE 1 = 1
       ${filters.organizationId ? sql`AND a.organization_id = ${filters.organizationId}::uuid` : sql``}
       ${actionLike ? sql`AND a.action LIKE ${actionLike}` : sql``}
       ${actorType ? sql`AND a.actor_type = ${actorType}::audit_actor` : sql``}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as {
    id: number;
    actor_type: string;
    actor_id: string | null;
    organization_id: string | null;
    organization_name: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    before: unknown;
    after: unknown;
    ip: string | null;
    created_at: Date | string;
  }[];

  const counted = (await db.execute(sql`
    SELECT count(*)::int AS n
      FROM audit_log a
     WHERE 1 = 1
       ${filters.organizationId ? sql`AND a.organization_id = ${filters.organizationId}::uuid` : sql``}
       ${actionLike ? sql`AND a.action LIKE ${actionLike}` : sql``}
       ${actorType ? sql`AND a.actor_type = ${actorType}::audit_actor` : sql``}
  `)) as unknown as { n: number }[];

  return {
    rows: rows.map((r) => ({
      id: Number(r.id),
      actorType: r.actor_type,
      actorId: r.actor_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      before: r.before,
      after: r.after,
      ip: r.ip,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    total: Number(counted[0]?.n ?? 0),
    page,
    pageSize,
  };
}