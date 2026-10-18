/**
 * GET /api/admin/ops — job health, standing alerts, ledger freshness.
 *
 * STAFF ONLY, `read_only`.
 *
 * These three are returned together because they answer one question:
 * "can I trust the numbers on the other screens?"
 *
 * `collect_usage` runs on a timer. When it dies, nothing raises — the
 * ledger simply stops growing, and the first sign is a customer saying
 * their bill looks wrong. Before this route the only way to know was to
 * notice that yourself. `ledgerFreshness` makes staleness explicit so
 * an operator reading a suspicious invoice can check the collector
 * before arguing with the customer about the amount.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { jobHealth, ledgerFreshness, standingAlerts } from '@/lib/admin/ops';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireStaff('read_only');
    const [jobs, alerts, freshness] = await Promise.all([
      jobHealth(),
      standingAlerts(),
      ledgerFreshness(),
    ]);
    return Response.json({ jobs, alerts, freshness });
  } catch (e) {
    return errorResponse(e);
  }
}