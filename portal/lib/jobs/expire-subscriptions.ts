/**
 * expire_subscriptions — the two things time does on its own.
 *
 *   1. "Cancel at period end" subscriptions whose period has ended flip
 *      to canceled and the cut is pushed.
 *   2. D17 payments whose payment window elapsed are marked expired, so
 *      the verification queue stays clean and an old authorization
 *      number cannot activate a plan months later.
 *
 * Both follow PLATFORM.md §5.3: the SQL updates the rows first, then
 * each affected org is pushed. If the process dies between the two, the
 * next run re-pushes — both halves are idempotent.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { appendAudit } from '@/lib/audit';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

export async function expireSubscriptions(): Promise<{
  expired: number;
  failed: number;
  paymentsExpired: number;
}> {
  const flipped = (await db.execute(sql`
    UPDATE subscriptions
       SET status = 'canceled', updated_at = now()
     WHERE cancel_at_period_end = true
       AND status = 'active'
       AND current_period_end IS NOT NULL
       AND current_period_end < now()
     RETURNING organization_id
  `)) as unknown as { organization_id: string }[];

  let failed = 0;
  for (const row of flipped) {
    const sync = await syncOrganizationEntitlements(
      row.organization_id,
      'expire_subscriptions',
    );
    if (!sync.ok) {
      // A failed push leaves the entitlement row `failed`, which the
      // reconcile job retries and the alert job reports. The status
      // flip stands — the customer asked to stop.
      failed++;
      log.error('expire_subscriptions: sync failed', {
        organizationId: row.organization_id,
        error: sync.error,
      });
    }
  }

  // D17 payments nobody paid inside the window. The subscription row
  // itself stays `incomplete` (which the entitlement system already
  // treats as a cut); only the payment claim expires, and a fresh
  // checkout resets the same row.
  const stalePayments = (await db.execute(sql`
    UPDATE payments_d17
       SET status = 'expired', updated_at = now()
     WHERE status = 'pending_payment'
       AND expires_at < now()
     RETURNING id, organization_id
  `)) as unknown as { id: string; organization_id: string }[];

  for (const row of stalePayments) {
    await appendAudit({
      actorType: 'system',
      actorId: null,
      organizationId: row.organization_id,
      action: 'd17.expired',
      targetType: 'payment_d17',
      targetId: row.id,
      after: { reason: 'window_elapsed' },
    });
  }

  if (stalePayments.length) {
    log.info('expire_subscriptions: D17 payments expired', {
      count: stalePayments.length,
    });
  }

  return { expired: flipped.length, failed, paymentsExpired: stalePayments.length };
}
