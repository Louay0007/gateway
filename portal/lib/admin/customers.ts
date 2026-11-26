/**
 * Customers — a PERSON, not an account.
 *
 * THE GAP THIS FILLS. Every console query started at `organizations`
 * (`lib/admin/orgs.ts`) because that is the billing entity. Nothing started at
 * `users`, so "jane@acme.com emailed us" had no route in the product: an
 * operator could see her ORG only if they already knew which one it was, and a
 * person belonging to two orgs was two unrelated rows on two pages.
 *
 * READ-ONLY. Nothing here writes. Acting on an account stays in
 * `lib/billing/admin-console.ts` and `lib/admin/subscriptions.ts`, where the
 * audit row and the gateway push already live — a second write path is how
 * two implementations of the same action drift apart.
 *
 * Same SQL discipline as `lib/admin/orgs.ts`: `db.execute` returns
 * SNAKE_CASE keys, so every read below coerces explicitly. Reading a
 * camelCase name off a raw row yields `undefined`, which parses as `NaN` and
 * renders as a plausible wrong number rather than an error.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';

// ───────────────────────────────────────────────────────────────────────
//  Search
// ───────────────────────────────────────────────────────────────────────

export interface CustomerOrgRef {
  orgId: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  planCode: string | null;
}

export interface CustomerRow {
  userId: string;
  email: string;
  name: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  /** Every org this person belongs to, with their role in each. */
  orgs: CustomerOrgRef[];
  /** True when this person also holds a staff row — rare, and worth flagging. */
  isStaff: boolean;
  /** True when a login throttle bucket is currently locking them out. */
  lockedOut: boolean;
}

export interface CustomerFilters {
  /** Free text over email and name. */
  q?: string;
  /** Only people who have never confirmed their address — the paywall. */
  onlyUnverified?: boolean;
  /** Only people who belong to no org at all. */
  onlyWithoutOrg?: boolean;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 100;

/**
 * Escape a LIKE pattern.
 *
 * A search for "100%" must not become a wildcard that matches every row, and
 * "_" must not become "any single character". Backslash is Postgres's default
 * LIKE escape character, so escaping these three is sufficient.
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Search people by email or name.
 *
 * ORGS ARE AGGREGATED IN THE SAME QUERY, not fetched per row. A page of 25
 * people each in two orgs would otherwise be 51 round trips on a screen an
 * operator opens while a customer is on the phone.
 *
 * `isStaff` and `lockedOut` are EXISTS subqueries rather than joins: both are
 * FALSE for almost every row, and a LEFT JOIN would make the aggregate
 * grouping ambiguous for no benefit.
 */
export async function searchCustomers(
  filters: CustomerFilters = {},
): Promise<{ rows: CustomerRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const q = filters.q?.trim();
  const like = q ? likePattern(q) : null;

  // Shared by the page and the count, so "142 people match" is a fact about
  // the database rather than an artifact of which page arrived.
  const where = sql`
    WHERE 1 = 1
      ${like ? sql`AND (u.email ILIKE ${like} OR COALESCE(u.name, '') ILIKE ${like})` : sql``}
      ${filters.onlyUnverified ? sql`AND u.email_verified_at IS NULL` : sql``}
      ${
        filters.onlyWithoutOrg
          ? sql`AND NOT EXISTS (SELECT 1 FROM organization_members m2 WHERE m2.user_id = u.id)`
          : sql``
      }
  `;

  const rows = (await db.execute(sql`
    SELECT u.id::text          AS user_id,
           u.email,
           u.name,
           u.email_verified_at,
           u.created_at,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'orgId',    o.id::text,
                 'name',     o.name,
                 'slug',     o.slug,
                 'status',   o.status::text,
                 'role',     m.role::text,
                 'planCode', p.code
               )
               ORDER BY m.created_at ASC
             ) FILTER (WHERE o.id IS NOT NULL),
             '[]'::jsonb
           ) AS orgs,
           EXISTS (SELECT 1 FROM staff_users s WHERE lower(s.email) = lower(u.email)) AS is_staff,
           EXISTS (
             SELECT 1 FROM auth_login_attempts a
              WHERE a.bucket = ('id:' || lower(u.email)) AND a.locked_until > now()
           ) AS locked_out
      FROM users u
      LEFT JOIN organization_members m ON m.user_id = u.id
      LEFT JOIN organizations o        ON o.id = m.organization_id
      LEFT JOIN subscriptions  sub     ON sub.organization_id = o.id
      LEFT JOIN plans          p       ON p.id = sub.plan_id
      ${where}
     GROUP BY u.id, u.email, u.name, u.email_verified_at, u.created_at
     ORDER BY u.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as RawCustomer[];

  const counted = (await db.execute(sql`
    SELECT count(*)::int AS n FROM users u ${where}
  `)) as unknown as { n: number }[];

  return {
    rows: rows.map(toCustomerRow),
    total: Number(counted[0]?.n ?? 0),
    page,
    pageSize,
  };
}

interface RawCustomer {
  user_id: string;
  email: string;
  name: string | null;
  email_verified_at: Date | string | null;
  created_at: Date | string;
  orgs: CustomerOrgRef[] | null;
  is_staff: boolean;
  locked_out: boolean;
}

function toCustomerRow(r: RawCustomer): CustomerRow {
  return {
    userId: r.user_id,
    email: r.email,
    name: r.name,
    emailVerifiedAt: iso(r.email_verified_at),
    // postgres.js hands a timestamptz back as a STRING. Coerce here or the
    // page throws on `.toISOString()` — a bug this codebase has hit twice.
    createdAt: new Date(r.created_at).toISOString(),
    orgs: (r.orgs ?? []).map((o) => ({
      orgId: o.orgId,
      name: o.name,
      slug: o.slug,
      status: o.status,
      role: o.role,
      planCode: o.planCode,
    })),
    isStaff: Boolean(r.is_staff),
    lockedOut: Boolean(r.locked_out),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  One person
// ───────────────────────────────────────────────────────────────────────

export interface CustomerDetail extends CustomerRow {
  /** Live counts across every org they belong to. */
  totals: {
    orgCount: number;
    activeKeys: number;
    /** Sum of `cost_customer_usd` over the last 30 days, all their orgs. */
    revenue30dUsd: number;
    paymentCount: number;
  };
  /** Their staff row, when they have one. */
  staff: { id: string; username: string | null; role: string; revokedAt: string | null } | null;
  /** Whether a login throttle bucket exists at all (locked or merely failing). */
  throttle: { failures: number; lockedUntil: string | null } | null;
  /** Their most recent console-relevant audit rows, across all their orgs. */
  recentAudit: {
    id: number;
    action: string;
    organizationId: string | null;
    createdAt: string;
  }[];
}

export async function customerDetail(userId: string): Promise<CustomerDetail | null> {
  const base = (await db.execute(sql`
    SELECT u.id::text          AS user_id,
           u.email,
           u.name,
           u.email_verified_at,
           u.created_at,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'orgId',    o.id::text,
                 'name',     o.name,
                 'slug',     o.slug,
                 'status',   o.status::text,
                 'role',     m.role::text,
                 'planCode', p.code
               )
               ORDER BY m.created_at ASC
             ) FILTER (WHERE o.id IS NOT NULL),
             '[]'::jsonb
           ) AS orgs,
           EXISTS (SELECT 1 FROM staff_users s WHERE lower(s.email) = lower(u.email)) AS is_staff,
           EXISTS (
             SELECT 1 FROM auth_login_attempts a
              WHERE a.bucket = ('id:' || lower(u.email)) AND a.locked_until > now()
           ) AS locked_out
      FROM users u
      LEFT JOIN organization_members m ON m.user_id = u.id
      LEFT JOIN organizations o        ON o.id = m.organization_id
      LEFT JOIN subscriptions  sub     ON sub.organization_id = o.id
      LEFT JOIN plans          p       ON p.id = sub.plan_id
     WHERE u.id = ${userId}::uuid
     GROUP BY u.id, u.email, u.name, u.email_verified_at, u.created_at
  `)) as unknown as RawCustomer[];

  const row = base[0];
  if (!row) return null;

  const orgIds = (row.orgs ?? []).map((o) => o.orgId);

  // Everything below is scoped to the orgs this person actually belongs to.
  // An empty list is a real state (a user with no org yet), so each query is
  // skipped rather than run with an empty IN — which Postgres would reject.
  const [totals, staff, throttle, audit] = await Promise.all([
    totalsFor(row.user_id, orgIds),
    db.execute(sql`
      SELECT s.id::text AS id, s.username, s.role::text AS role, s.revoked_at
        FROM staff_users s
       WHERE lower(s.email) = lower(${row.email})
       LIMIT 1
    `) as unknown as Promise<{ id: string; username: string | null; role: string; revoked_at: Date | string | null }[]>,
    db.execute(sql`
      SELECT failures, locked_until
        FROM auth_login_attempts
       WHERE bucket = ('id:' || lower(${row.email}))
       LIMIT 1
    `) as unknown as Promise<{ failures: number; locked_until: Date | string | null }[]>,
    orgIds.length
      ? (db.execute(sql`
          SELECT a.id, a.action, a.organization_id::text AS organization_id, a.created_at
            FROM audit_log a
           WHERE a.organization_id IN (${orgIdList(orgIds)})
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 20
        `) as unknown as Promise<
          { id: number; action: string; organization_id: string | null; created_at: Date | string }[]
        >)
      : Promise.resolve([]),
  ]);

  const staffRow = staff[0];

  return {
    ...toCustomerRow(row),
    totals,
    staff: staffRow
      ? {
          id: staffRow.id,
          username: staffRow.username,
          role: staffRow.role,
          revokedAt: iso(staffRow.revoked_at),
        }
      : null,
    throttle: throttle[0]
      ? { failures: Number(throttle[0].failures), lockedUntil: iso(throttle[0].locked_until) }
      : null,
    recentAudit: audit.map((a) => ({
      id: Number(a.id),
      action: a.action,
      organizationId: a.organization_id,
      createdAt: new Date(a.created_at).toISOString(),
    })),
  };
}

/**
 * Live counts across a person's orgs.
 *
 * Revenue is summed from `usage_records` over 30 days rather than read from a
 * rollup, because a rollup would be a second source of truth that can lag —
 * and the number an operator quotes to a customer should be the ledger's.
 */
async function totalsFor(
  userId: string,
  orgIds: string[],
): Promise<CustomerDetail['totals']> {
  if (!orgIds.length) {
    return { orgCount: 0, activeKeys: 0, revenue30dUsd: 0, paymentCount: 0 };
  }

  const idList = orgIdList(orgIds);

  const [counts] = (await db.execute(sql`
    SELECT (SELECT count(*)::int FROM api_keys k
             WHERE k.organization_id IN (${idList}) AND k.revoked_at IS NULL) AS active_keys,
           (SELECT COALESCE(sum(ur.cost_customer_usd), 0)::float8 FROM usage_records ur
             WHERE ur.organization_id IN (${idList})
               AND ur.occurred_at > now() - interval '30 days')             AS revenue_30d,
           (SELECT count(*)::int FROM payments_d17 pay
             WHERE pay.organization_id IN (${idList}))                       AS payment_count
  `)) as unknown as { active_keys: number; revenue_30d: number; payment_count: number }[];

  return {
    orgCount: orgIds.length,
    activeKeys: Number(counts?.active_keys ?? 0),
    revenue30dUsd: Number(counts?.revenue_30d ?? 0),
    paymentCount: Number(counts?.payment_count ?? 0),
  };
}

/**
 * One person's org ids as a bound `IN (…)` list.
 *
 * Built with `sql.join`, NEVER by interpolating the JS array or stringifying
 * the ids. Postgres binds a JS array as ONE parameter rather than an array,
 * so `IN (${ids})` sends a bare scalar and answers "malformed array literal";
 * and a hand-built `ANY(ARRAY['…'])` through `sql.raw` would be string
 * concatenation of values into SQL, which is the one thing this codebase does
 * not do. `sql.join` keeps every id a bound parameter.
 */
function orgIdList(orgIds: string[]) {
  return sql.join(orgIds.map((id) => sql`${id}::uuid`), sql`, `);
}

function iso(v: Date | string | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}
