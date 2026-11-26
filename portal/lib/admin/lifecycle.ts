/**
 * Subscription lifecycle — the READ side of /admin/subscriptions.
 *
 * `lib/admin/subscriptions.ts` holds the writes (cancel, resume, remove,
 * extend, grant); this file holds the queue an operator reads to decide which
 * one to press. Same split `lib/admin/orgs.ts` draws against
 * `lib/billing/admin-console.ts`.
 *
 * One row per org's CURRENT subscription, chosen the way the entitlement sync
 * chooses it — live first, then most recently updated. Showing every
 * historical row would make "what expires next" unanswerable: a cancelled
 * subscription from March would sit at the top forever.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';

export interface SubscriptionLifecycleRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  orgStatus: string;
  planCode: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  /** Set when an OPERATOR removed it (0055), as opposed to a cancellation. */
  removedAt: string | null;
  removalReason: string | null;
  createdAt: string;
}

export interface LifecycleFilters {
  status?: string;
  organizationId?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 200;

/**
 * The lifecycle queue, soonest-to-expire first.
 *
 * `DISTINCT ON (organization_id)` with the SAME ordering the sync uses is what
 * makes this "the subscription", singular: an org can have several rows
 * (renewals create new ones), and picking a different one here than
 * `resolveSubscription()` does would let the console act on a row the gateway
 * is not enforcing.
 */
export async function listSubscriptionLifecycle(
  filters: LifecycleFilters = {},
): Promise<{ rows: SubscriptionLifecycleRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const where = sql`
    WHERE o.status <> 'deleted'
      ${filters.status ? sql`AND s.status = ${filters.status}::sub_status` : sql``}
      ${filters.organizationId ? sql`AND s.organization_id = ${filters.organizationId}::uuid` : sql``}
  `;

  // The dedupe happens AFTER the status filter, deliberately: filtering for
  // 'canceled' must show the org whose CURRENT row is cancelled, not an org
  // that happens to have a cancelled row somewhere in its history.
  const rows = (await db.execute(sql`
    WITH current AS (
      SELECT DISTINCT ON (s.organization_id)
             s.organization_id, s.id, s.status, s.current_period_start,
             s.current_period_end, s.cancel_at_period_end, s.trial_end,
             s.removed_at, s.removal_reason, s.created_at, s.plan_id
        FROM subscriptions s
       ORDER BY s.organization_id,
                (s.status IN ('active','past_due','paused')) DESC,
                s.updated_at DESC
    )
    SELECT c.id::text, c.organization_id::text AS organization_id,
           o.name AS organization_name, o.slug AS organization_slug,
           o.status::text AS org_status,
           p.code AS plan_code,
           c.status::text AS status,
           c.current_period_start, c.current_period_end,
           c.cancel_at_period_end, c.trial_end,
           c.removed_at, c.removal_reason, c.created_at
      FROM current c
      JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN plans p ON p.id = c.plan_id
      ${where}
     ORDER BY c.current_period_end ASC NULLS LAST, o.name ASC
     LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as {
    id: string;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    org_status: string;
    plan_code: string | null;
    status: string;
    current_period_start: Date | string | null;
    current_period_end: Date | string | null;
    cancel_at_period_end: boolean;
    trial_end: Date | string | null;
    removed_at: Date | string | null;
    removal_reason: string | null;
    created_at: Date | string;
  }[];

  const counted = (await db.execute(sql`
    WITH current AS (
      SELECT DISTINCT ON (s.organization_id)
             s.organization_id, s.id, s.status, s.plan_id
        FROM subscriptions s
       ORDER BY s.organization_id,
                (s.status IN ('active','past_due','paused')) DESC,
                s.updated_at DESC
    )
    SELECT count(*)::int AS n
      FROM current c
      JOIN organizations o ON o.id = c.organization_id
      JOIN subscriptions s ON s.id = c.id
      ${where}
  `)) as unknown as { n: number }[];

  return {
    rows: rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      organizationSlug: r.organization_slug,
      orgStatus: r.org_status,
      planCode: r.plan_code,
      status: r.status,
      currentPeriodStart: iso(r.current_period_start),
      currentPeriodEnd: iso(r.current_period_end),
      cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
      trialEnd: iso(r.trial_end),
      removedAt: iso(r.removed_at),
      removalReason: r.removal_reason,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    total: Number(counted[0]?.n ?? 0),
    page,
    pageSize,
  };
}

function iso(v: Date | string | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}
