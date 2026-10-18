/**
 * /api/admin/credits — the credit-note ledger: POST records, GET reads.
 *
 * STAFF ONLY. POST requires role `admin` (moving money on a customer's
 * behalf is not a read-only act); GET requires only `read_only`, because
 * reading the refund ledger is exactly what that role is for.
 *
 * D17 has no refund API, so this table is the RECORD of a manual
 * transfer ops makes by hand; it does not move money itself. Amounts are
 * SIGNED: negative refunds the customer, positive credits their next
 * bill.
 *
 * GET CLOSES AN ACCOUNTING HOLE. `recordCreditNote` and `listCreditNotes`
 * both existed since 0009, and nothing ever called the list — staff could
 * record a refund and never read it back, so "what have we refunded this
 * customer?" had to be answered by querying Postgres by hand.
 *
 * APPEND-ONLY, like the table it reads. There is no PUT or DELETE here
 * and none will be added: a credit note records money that actually
 * moved, and a correction is another credit note, so the ledger always
 * explains itself.
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireStaff } from '@/lib/auth/authorize';
import { recordCreditNote } from '@/lib/billing/admin-console';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  organizationId: z.string().trim().regex(UUID, 'Choose an organization.'),
  amountCents: z.number().int().refine((n) => n !== 0, 'Enter a non-zero amount.'),
  currency: z.enum(['TND', 'USD']).optional(),
  reason: z.string().trim().min(3, 'Give a reason for the record.').max(500),
});

// ── GET — the ledger ───────────────────────────────────────────────────
export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('read_only');
    const sp = new URL(request.url).searchParams;

    const organizationId = sp.get('organization');
    if (organizationId && !UUID.test(organizationId)) {
      return jsonError('validation', 'organization must be a UUID.');
    }

    const page = Number(sp.get('page') ?? '1');
    const pageSize = Number(sp.get('page_size') ?? '50');
    if (!Number.isFinite(page) || page < 1) {
      return jsonError('validation', 'page must be a positive whole number.');
    }
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      return jsonError('validation', 'page_size must be between 1 and 100.');
    }
    const offset = (page - 1) * pageSize;

    const rows = (await db.execute(sql`
      SELECT c.id::text, c.organization_id::text AS organization_id,
             o.name AS organization_name, o.slug AS organization_slug,
             c.amount_cents, c.currency, c.reason, c.created_by, c.created_at
        FROM credit_notes c
        LEFT JOIN organizations o ON o.id = c.organization_id
       ${organizationId ? sql`WHERE c.organization_id = ${organizationId}::uuid` : sql``}
       ORDER BY c.created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}
    `)) as unknown as {
      id: string;
      organization_id: string;
      organization_name: string | null;
      organization_slug: string | null;
      amount_cents: number;
      currency: string;
      reason: string;
      created_by: string;
      created_at: Date | string;
    }[];

    // Counted and totalled over the SAME filter as the page, so the
    // summary describes the filtered set rather than whichever page
    // happened to arrive.
    const summary = (await db.execute(sql`
      SELECT count(*)::int AS n,
             COALESCE(sum(amount_cents) FILTER (WHERE currency = 'USD'), 0)::float8 / 100
               AS net_usd,
             COALESCE(sum(amount_cents) FILTER (WHERE currency = 'TND'), 0)::float8 / 100
               AS net_tnd
        FROM credit_notes
       ${organizationId ? sql`WHERE organization_id = ${organizationId}::uuid` : sql``}
    `)) as unknown as { n: number; net_usd: number; net_tnd: number }[];

    return Response.json({
      rows: rows.map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        organizationSlug: r.organization_slug,
        amountCents: Number(r.amount_cents),
        currency: r.currency,
        reason: r.reason,
        createdBy: r.created_by,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total: Number(summary[0]?.n ?? 0),
      netUsd: Number(summary[0]?.net_usd ?? 0),
      netTnd: Number(summary[0]?.net_tnd ?? 0),
      page,
      pageSize,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// ── POST — record a credit ─────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const staff = await requireStaff('admin');
    const result = await recordCreditNote(staff.id, parsed.data);
    if (!result.ok) {
      if (result.error === 'reason_required') {
        return jsonError('validation', 'Give a reason for the record.');
      }
      if (result.error === 'amount_required') {
        return jsonError('validation', 'Enter a non-zero amount.');
      }
      return jsonError('not_found', 'No such organization.');
    }
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}
