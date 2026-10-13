/**
 * expire_subscriptions — the two things time does on its own.
 *
 *   1. "Cancel at period end" subscriptions whose period has ended flip
 *      to canceled and the cut is pushed.
 *   2. D17 payments whose payment window elapsed are marked expired, so
 *      the verification queue stays clean and an old authorization
 *      number cannot activate a plan months later.
 *   3. LAPSED renewals (D1): an active subscription whose period ended
 *      WITHOUT cancel_at_period_end is a customer who has not paid for
 *      the next period — not a customer who asked to leave. It goes
 *      past_due (grace, access continues) for GRACE_DAYS, then unpaid
 *      (cut). This is what keeps "renews in N days" honest: the period
 *      lapsing is visible before access dies.
 *
 * All three follow PLATFORM.md §5.3: the SQL updates the rows first, then
 * each affected org is pushed. If the process dies between the two, the
 * next run re-pushes — both halves are idempotent.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { appendAudit } from '@/lib/audit';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

/** Grace after a period lapses unpaid before access is cut. D1. */
export const RENEWAL_GRACE_DAYS = 7;

export async function expireSubscriptions(): Promise<{
  expired: number;
  failed: number;
  paymentsExpired: number;
  lapsed: number;
  graceCut: number;
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
  // treats as a cut); only the payment claim expires. Since 0007 a
  // subscription may have MANY rows, so expiring one pending row never
  // touches the subscription — a fresh checkout inserts a new row.
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

  // ── Lapsed renewals: active period ended without cancel flag ──────
  // Not a cancellation — the customer simply has not paid for the next
  // period yet. past_due keeps access (STATUS_EFFECT) for the grace
  // window; the UI reads it as "renews overdue, pay now".
  const lapsed = (await db.execute(sql`
    UPDATE subscriptions
       SET status = 'past_due', updated_at = now()
     WHERE status = 'active'
       AND cancel_at_period_end = false
       AND current_period_end IS NOT NULL
       AND current_period_end < now()
     RETURNING organization_id
  `)) as unknown as { organization_id: string }[];

  for (const row of lapsed) {
    await appendAudit({
      actorType: 'system',
      actorId: null,
      organizationId: row.organization_id,
      action: 'subscription.lapsed',
      targetType: 'subscription',
      targetId: null,
      after: { to: 'past_due', reason: 'period_ended_unpaid' },
    });
    // No sync: past_due is still 'full' effect, access unchanged.
  }

  // ── Grace expiry: past_due beyond GRACE_DAYS → unpaid + cut ───────
  // Keys stay alive but starved (CUT_BUDGET via sync) so re-subscribing
  // is instant — D3. Never revoke: revocation would make renewal require
  // support, which is the opposite of what a lapsed payer needs.
  const graceCut = (await db.execute(sql`
    UPDATE subscriptions
       SET status = 'unpaid', updated_at = now()
     WHERE status = 'past_due'
       AND current_period_end IS NOT NULL
       AND current_period_end < now() - (${RENEWAL_GRACE_DAYS} * interval '1 day')
     RETURNING organization_id
  `)) as unknown as { organization_id: string }[];

  for (const row of graceCut) {
    const sync = await syncOrganizationEntitlements(
      row.organization_id,
      'expire_subscriptions:grace',
    );
    if (!sync.ok) {
      failed++;
      log.error('expire_subscriptions: grace cut sync failed', {
        organizationId: row.organization_id,
        error: sync.error,
      });
    } else {
      await appendAudit({
        actorType: 'system',
        actorId: null,
        organizationId: row.organization_id,
        action: 'subscription.grace_cut',
        targetType: 'subscription',
        targetId: null,
        after: { to: 'unpaid', reason: 'grace_elapsed' },
      });
    }
  }

  return {
    expired: flipped.length,
    failed,
    paymentsExpired: stalePayments.length,
    lapsed: lapsed.length,
    graceCut: graceCut.length,
  };
}
