/**
 * GET /api/admin/d17/export — CSV of D17 payments for accounting.
 *
 * Staff only. The export carries the fx snapshot (usd_cents, fx_rate)
 * next to the TND amount precisely so reconciliation against the D17
 * app's history is arithmetic rather than archaeology.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { d17PaymentsCsv } from '@/lib/billing/d17-admin';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('support');

    const days = Number(new URL(request.url).searchParams.get('days') ?? '365');
    const csv = await d17PaymentsCsv(
      Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 365,
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="d17-payments-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
