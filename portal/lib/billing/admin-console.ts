/**
 * Admin console — the operations surface beyond the D17 queue.
 *
 * What it is for. A money-moving product needs three manual powers that
 * the customer UI must never have:
 *
 *   SUSPEND / REACTIVATE — stop an abusive or fraudulent account now.
 *     Enforced through `syncOrganizationEntitlements`, which reads
 *     organizations.status and cuts a non-active org, so the suspension
 *     is a real gateway change, not a flag. Reactivation re-pushes.
 *
 *   RETRY SYNC — an entitlement push that failed (a gateway blip) leaves
 *     the org `failed`. The reconciler retries hourly; an operator
 *     answering a customer should not have to wait for the clock.
 *
 *   CREDIT NOTES — D17 has no refund API, so a refund is a manual
 *     transfer ops makes by hand. `credit_notes` is the record of it.
 *
 * STAFF ONLY, and the ROUTES enforce that (`requireStaff`); this module
 * takes the staff id it acts as and writes it to every audit row, so
 * "who suspended this org" always has an answer. Nothing here reads an
 * organization the caller belongs to — staff are never org members
 * (PLATFORM.md §8.5).
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { creditNotes, organizations } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';

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
  periodCostUsd: number;
  hardCapCents: number | null;
  keyCount: number;
}

/**
 * Every non-deleted org, newest first, with the one line an operator
 * needs: who they are, what they are on, whether the gateway agrees, and
 * what they have spent this period. Bounded to 200 — this is a review
 * surface, not a data export.
 */
export async function listAdminOrgs(): Promise<AdminOrgRow[]> {
  const rows = (await db.execute(sql`
    SELECT o.id, o.name, o.slug, o.status::text AS status,
           p.code AS plan_code, p.hard_cap_cents,
           s.status::text AS sub_status, s.current_period_end,
           e.status::text AS entitlement_status, e.last_error AS entitlement_error,
           COALESCE((
             SELECT sum(ur.cost_customer_usd)
               FROM usage_records ur
              WHERE ur.organization_id = o.id
                AND ur.occurred_at >= COALESCE(s.current_period_start, date_trunc('month', now()))
           ), 0)::float8 AS period_cost_usd,
           (SELECT count(*) FROM api_keys k
             WHERE k.organization_id = o.id AND k.revoked_at IS NULL)::int AS key_count
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN entitlements e ON e.organization_id = o.id
     WHERE o.status <> 'deleted'
     ORDER BY o.created_at DESC
     LIMIT 200
  `)) as unknown as {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_code: string | null;
    hard_cap_cents: number | null;
    sub_status: string | null;
    current_period_end: Date | string | null;
    entitlement_status: string | null;
    entitlement_error: string | null;
    period_cost_usd: number;
    key_count: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    planCode: r.plan_code,
    subStatus: r.sub_status,
    // `db.execute` hands back the driver's native value, which for a
    // timestamptz is a STRING under postgres.js — not the Date a
    // relational query would map to. Coerce, or the page throws on
    // `.toISOString`. (The proof caught this.)
    currentPeriodEnd: r.current_period_end == null ? null : new Date(r.current_period_end).toISOString(),
    entitlementStatus: r.entitlement_status,
    entitlementError: r.entitlement_error,
    periodCostUsd: Number(r.period_cost_usd),
    hardCapCents: r.hard_cap_cents,
    keyCount: Number(r.key_count),
  }));
}

export interface AdminActionResult {
  ok: boolean;
  alreadyApplied?: boolean;
  error?: string;
  syncOk?: boolean;
  syncError?: string | null;
  effect?: string;
  keysSynced?: number;
}

/**
 * Suspend or reactivate an org. The gateway push is the point: flipping
 * the column alone leaves the account spending, because the enforcement
 * point is LiteLLM, not this table.
 */
export async function setOrganizationStatus(
  staffId: string,
  orgId: string,
  status: 'suspended' | 'active',
  reason?: string,
): Promise<AdminActionResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { ok: false, error: 'not_found' };
  if (org.status === 'deleted') return { ok: false, error: 'deleted' };
  if (org.status === status) return { ok: true, alreadyApplied: true };

  await db
    .update(organizations)
    .set({ status, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  // Status is now written; push it. A suspended org resolves to a cut in
  // sync (0009), so this is the line that actually stops the spend.
  const sync = await syncOrganizationEntitlements(orgId, `admin:org-${status}`);

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: status === 'suspended' ? 'organization.suspended' : 'organization.reactivated',
    targetType: 'organization',
    targetId: orgId,
    before: { status: org.status },
    after: { status, reason: reason ?? null, syncOk: sync.ok, syncError: sync.error ?? null },
  });

  return { ok: true, syncOk: sync.ok, syncError: sync.error ?? null, effect: sync.effect };
}

/** Re-push an org's entitlement now, instead of waiting for the hourly job. */
export async function retryEntitlementSync(
  staffId: string,
  orgId: string,
): Promise<AdminActionResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { ok: false, error: 'not_found' };

  const sync = await syncOrganizationEntitlements(orgId, 'admin:manual-retry');

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'entitlements.manual_retry',
    targetType: 'organization',
    targetId: orgId,
    after: { ok: sync.ok, effect: sync.effect, keysSynced: sync.keysSynced, error: sync.error ?? null },
  });

  return {
    ok: true,
    syncOk: sync.ok,
    syncError: sync.error ?? null,
    effect: sync.effect,
    keysSynced: sync.keysSynced,
  };
}

export interface CreditNoteInput {
  organizationId: string;
  amountCents: number;
  currency?: string;
  reason: string;
}

/** Record a manual credit/refund. Append-only; nothing edits a row. */
export async function recordCreditNote(
  staffId: string,
  input: CreditNoteInput,
): Promise<AdminActionResult & { id?: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'reason_required' };
  if (reason.length > 500) return { ok: false, error: 'reason_too_long' };
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return { ok: false, error: 'amount_required' };
  }
  const currency = (input.currency ?? 'TND').toUpperCase();
  if (!['TND', 'USD'].includes(currency)) return { ok: false, error: 'bad_currency' };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
  });
  if (!org) return { ok: false, error: 'not_found' };

  const [row] = await db
    .insert(creditNotes)
    .values({
      organizationId: input.organizationId,
      amountCents: input.amountCents,
      currency,
      reason,
      createdBy: staffId,
    })
    .returning({ id: creditNotes.id });

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: input.organizationId,
    action: 'billing.credit_note_recorded',
    targetType: 'credit_note',
    targetId: row?.id ?? null,
    after: { amountCents: input.amountCents, currency, reason },
  });

  return { ok: true, id: row?.id };
}

export interface CreditNoteRow {
  id: string;
  amountCents: number;
  currency: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export async function listCreditNotes(organizationId: string): Promise<CreditNoteRow[]> {
  const rows = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.organizationId, organizationId))
    .orderBy(sql`${creditNotes.createdAt} DESC`)
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amountCents,
    currency: r.currency,
    reason: r.reason,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}
