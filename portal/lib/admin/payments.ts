/**
 * Payments — everything that moved money, from both rails.
 *
 * TWO LANES, NEVER SUMMED. D17 (bank transfer, TND) writes a row in
 * `payments_d17` that we own. Dodo (card, USD) is a hosted checkout: we store
 * the subscription and one `billing_events` row per webhook, but **no amount
 * and no receipt** — those live at Dodo. A merged "revenue" total would
 * therefore be arithmetic across two different populations, which is exactly
 * the mistake `lib/admin/financials.ts` refuses to make when it keeps its four
 * revenue concepts apart.
 *
 * `listFailedEvents` is the part NOTHING in the product could show before.
 * `billing_events` is written by `applyCallback()` and read by no screen at
 * all, so a webhook that failed five times was invisible: the subscription
 * simply never activated, and the customer was told to try again.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';

// ───────────────────────────────────────────────────────────────────────
//  The ledger
// ───────────────────────────────────────────────────────────────────────

export interface AdminPaymentRow {
  id: string;
  /** Only one rail is in our database; the field exists so the page can say so. */
  rail: 'd17';
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  planCode: string | null;
  status: string;
  amountMillimes: number;
  currency: string;
  usdAmountCents: number;
  fxRate: number;
  authorizationNumber: string | null;
  senderPhone: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectReason: string | null;
  hasScreenshot: boolean;
  /** Seconds past `expires_at`, or null when it has not expired. */
  expiredForSeconds: number | null;
}

export interface PaymentFilters {
  status?: string;
  /** Plan code, authorization number, phone fragment, or org name. */
  q?: string;
  organizationId?: string;
  /** Only claims that expired while waiting for review — the sad queue. */
  staleOnly?: boolean;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 100;

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * The cross-org payment ledger, newest first.
 *
 * ONE QUERY FOR THE PAGE, ONE FOR THE COUNT, over the same WHERE — the same
 * discipline `listAdminOrgsFiltered` follows, so the header figure describes
 * the filtered set rather than whichever page arrived.
 */
export async function listPayments(
  filters: PaymentFilters = {},
): Promise<{ rows: AdminPaymentRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const q = filters.q?.trim();
  const like = q ? likePattern(q) : null;

  const where = sql`
    WHERE 1 = 1
      ${filters.status ? sql`AND p.status = ${filters.status}::d17_payment_status` : sql``}
      ${filters.organizationId ? sql`AND p.organization_id = ${filters.organizationId}::uuid` : sql``}
      ${
        filters.staleOnly
          ? sql`AND p.status IN ('pending_payment', 'proof_submitted', 'rejected') AND p.expires_at < now()`
          : sql``
      }
      ${
        like
          ? sql`AND (
              o.name ILIKE ${like}
              OR o.slug ILIKE ${like}
              OR COALESCE(p.authorization_number, '') ILIKE ${like}
              OR COALESCE(p.sender_phone, '') ILIKE ${like}
              OR COALESCE(pl.code, '') ILIKE ${like}
            )`
          : sql``
      }
  `;

  const rows = (await db.execute(sql`
    SELECT p.id::text,
           p.organization_id::text AS organization_id,
           o.name  AS organization_name,
           o.slug  AS organization_slug,
           pl.code AS plan_code,
           p.status::text AS status,
           p.amount_millimes,
           p.currency,
           p.usd_amount_cents,
           p.fx_rate::float8 AS fx_rate,
           p.authorization_number,
           p.sender_phone,
           p.submitted_at,
           p.verified_at,
           p.verified_by,
           p.reject_reason,
           (p.screenshot_path IS NOT NULL) AS has_screenshot,
           GREATEST(0, EXTRACT(EPOCH FROM (now() - p.expires_at)))::int AS expired_for_seconds
      FROM payments_d17 p
      JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN subscriptions s ON s.id = p.subscription_id
      LEFT JOIN plans pl ON pl.id = s.plan_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
  `)) as unknown as RawPayment[];

  const counted = (await db.execute(sql`
    SELECT count(*)::int AS n
      FROM payments_d17 p
      JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN subscriptions s ON s.id = p.subscription_id
      LEFT JOIN plans pl ON pl.id = s.plan_id
      ${where}
  `)) as unknown as { n: number }[];

  return {
    rows: rows.map(toPaymentRow),
    total: Number(counted[0]?.n ?? 0),
    page,
    pageSize,
  };
}

interface RawPayment {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  plan_code: string | null;
  status: string;
  amount_millimes: number;
  currency: string;
  usd_amount_cents: number;
  fx_rate: number;
  authorization_number: string | null;
  sender_phone: string | null;
  submitted_at: Date | string | null;
  verified_at: Date | string | null;
  verified_by: string | null;
  reject_reason: string | null;
  has_screenshot: boolean;
  expired_for_seconds: number;
}

function toPaymentRow(r: RawPayment): AdminPaymentRow {
  return {
    id: r.id,
    rail: 'd17',
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    organizationSlug: r.organization_slug,
    planCode: r.plan_code,
    status: r.status,
    amountMillimes: Number(r.amount_millimes),
    currency: r.currency,
    usdAmountCents: Number(r.usd_amount_cents),
    fxRate: Number(r.fx_rate),
    authorizationNumber: r.authorization_number,
    senderPhone: r.sender_phone,
    submittedAt: iso(r.submitted_at),
    verifiedAt: iso(r.verified_at),
    verifiedBy: r.verified_by,
    rejectReason: r.reject_reason,
    hasScreenshot: Boolean(r.has_screenshot),
    // Zero means "not expired yet" — `GREATEST(0, now - expires)` is 0 for a
    // future expiry too, so the caller must compare the status as well.
    expiredForSeconds: Number(r.expired_for_seconds) > 0 ? Number(r.expired_for_seconds) : null,
  };
}

/**
 * One payment, end to end.
 *
 * Includes the automatic verifier's readings (0050) when the vision pass ran,
 * which is the "did a machine approve this, and what did it think it saw"
 * question that no screen could answer.
 */
export interface PaymentDetail {
  payment: AdminPaymentRow;
  subscription: {
    id: string;
    status: string;
    planCode: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    removedAt: string | null;
    removalReason: string | null;
  } | null;
  /** Readings from the automatic verifier, newest first. */
  verifications: {
    id: string;
    verdict: string;
    score: number;
    reason: string | null;
    createdAt: string;
  }[];
  /** Every rejection recorded for THIS payment, from the audit trail. */
  rejections: { reason: string | null; createdAt: string }[];
}

export async function paymentDetail(paymentId: string): Promise<PaymentDetail | null> {
  const rows = (await db.execute(sql`
    SELECT p.id::text,
           p.organization_id::text AS organization_id,
           o.name  AS organization_name,
           o.slug  AS organization_slug,
           pl.code AS plan_code,
           p.status::text AS status,
           p.amount_millimes, p.currency, p.usd_amount_cents,
           p.fx_rate::float8 AS fx_rate,
           p.authorization_number, p.sender_phone,
           p.submitted_at, p.verified_at, p.verified_by, p.reject_reason,
           (p.screenshot_path IS NOT NULL) AS has_screenshot,
           GREATEST(0, EXTRACT(EPOCH FROM (now() - p.expires_at)))::int AS expired_for_seconds,
           p.subscription_id::text AS subscription_id
      FROM payments_d17 p
      JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN subscriptions s ON s.id = p.subscription_id
      LEFT JOIN plans pl ON pl.id = s.plan_id
     WHERE p.id = ${paymentId}::uuid
  `)) as unknown as (RawPayment & { subscription_id: string })[];

  const row = rows[0];
  if (!row) return null;

  const [subRows, verifyRows, rejectRows] = await Promise.all([
    db.execute(sql`
      SELECT s.id::text, s.status::text AS status, pl.code AS plan_code,
             s.current_period_start, s.current_period_end,
             s.removed_at, s.removal_reason
        FROM subscriptions s
        LEFT JOIN plans pl ON pl.id = s.plan_id
       WHERE s.id = ${row.subscription_id}::uuid
    `) as unknown as Promise<
      {
        id: string;
        status: string;
        plan_code: string | null;
        current_period_start: Date | string | null;
        current_period_end: Date | string | null;
        removed_at: Date | string | null;
        removal_reason: string | null;
      }[]
    >,
    db.execute(sql`
      SELECT v.id::text, v.verdict::text AS verdict, v.score, v.reason, v.created_at
        FROM payments_d17_verifications v
       WHERE v.payment_id = ${paymentId}::uuid
       ORDER BY v.created_at DESC
       LIMIT 10
    `) as unknown as Promise<
      { id: string; verdict: string; score: number; reason: string | null; created_at: Date | string }[]
    >,
    db.execute(sql`
      SELECT a.after, a.created_at
        FROM audit_log a
       WHERE a.action = 'd17.rejected'
         AND a.target_type = 'payment_d17'
         AND a.target_id = ${paymentId}
       ORDER BY a.created_at DESC
    `) as unknown as Promise<{ after: { reason?: string } | null; created_at: Date | string }[]>,
  ]);

  const sub = subRows[0];

  return {
    payment: toPaymentRow(row),
    subscription: sub
      ? {
          id: sub.id,
          status: sub.status,
          planCode: sub.plan_code,
          currentPeriodStart: iso(sub.current_period_start),
          currentPeriodEnd: iso(sub.current_period_end),
          removedAt: iso(sub.removed_at),
          removalReason: sub.removal_reason,
        }
      : null,
    verifications: verifyRows.map((v) => ({
      id: v.id,
      verdict: v.verdict,
      score: Number(v.score),
      reason: v.reason,
      createdAt: new Date(v.created_at).toISOString(),
    })),
    rejections: rejectRows.map((r) => ({
      reason: r.after?.reason ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Failed webhooks — the backlog nothing could see
// ───────────────────────────────────────────────────────────────────────

export interface BillingEventRow {
  id: string;
  /** Inferred from the id prefix: 'd17' | 'dodo' | 'dev'. */
  provider: string;
  receivedAt: string;
  attempts: number;
  lastError: string | null;
  /** Hours since receipt — the number that says "how long has this been broken". */
  ageHours: number;
}

/**
 * Webhooks that never completed, worst first.
 *
 * `processed_at IS NULL` is the whole definition of "failed" — an event either
 * got processed or it did not, and `attempts` distinguishes "still retrying"
 * from "gave up". Ordered by attempts DESC so the one that has failed five
 * times outranks the one that arrived a minute ago and failed once.
 *
 * Bounded (default 50): this is a "look at the problem" list, not an export.
 */
export async function listFailedEvents(limit = 50): Promise<BillingEventRow[]> {
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));

  const rows = (await db.execute(sql`
    SELECT id, received_at, attempts, last_error
      FROM billing_events
     WHERE processed_at IS NULL
     ORDER BY attempts DESC, received_at ASC
     LIMIT ${capped}
  `)) as unknown as {
    id: string;
    received_at: Date | string;
    attempts: number;
    last_error: string | null;
  }[];

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    provider: providerOf(r.id),
    receivedAt: new Date(r.received_at).toISOString(),
    attempts: Number(r.attempts),
    lastError: r.last_error,
    ageHours: Math.max(0, Math.round(((now - new Date(r.received_at).getTime()) / 3_600_000) * 10) / 10),
  }));
}

/**
 * Which rail sent this event.
 *
 * `applyCallback` uses a prefixed event id (`d17:<paymentId>:approved`,
 * `dodo:<id>`), so the prefix is the only provider marker the table stores —
 * there is no provider column, and adding one would mean backfilling rows we
 * cannot classify.
 */
function providerOf(id: string): string {
  const prefix = id.split(':')[0]?.toLowerCase();
  return prefix && ['d17', 'dodo', 'dev'].includes(prefix) ? prefix : 'unknown';
}

function iso(v: Date | string | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}
