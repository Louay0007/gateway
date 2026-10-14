/**
 * expire_trials — a free trial that ends is a subscription that has not
 * been paid for yet.
 *
 * The trial STARTS in lib/billing/service.ts:startTrial(), which sets the
 * subscription to `trialing` with current_period_start → trial_end. This
 * job is the other end of that bargain. When `trial_end` passes and the
 * customer has not converted, the row flips to `unpaid` and the cut is
 * pushed to the gateway.
 *
 * WHY `unpaid`, NOT `canceled`. D3 for the whole system: never revoke,
 * STARVE. `unpaid` resolves to the CUT_BUDGET effect (keys stay valid but
 * cannot spend), so a customer who subscribes the moment the trial ends
 * is back in business instantly — no support ticket, no new key. A
 * trial-ending cut is not a punishment; it is the paywall re-asserting
 * itself.
 *
 * If a D17 payment is approved AFTER this flip, `applyCallback` rolls the
 * period forward from `now` (the row is no longer live), so a late payer
 * gets a full period, not a period back-dated into their trial.
 *
 * SQL first, then push (PLATFORM.md §5.3), exactly like
 * expire_subscriptions — a crash between the two is repaired by the next
 * run, because both halves are idempotent.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { appendAudit } from '@/lib/audit';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

export async function expireTrials(): Promise<{ ended: number; failed: number }> {
  const ended = (await db.execute(sql`
    UPDATE subscriptions
       SET status = 'unpaid', updated_at = now()
     WHERE status = 'trialing'
       AND trial_end IS NOT NULL
       AND trial_end < now()
     RETURNING organization_id, id
  `)) as unknown as { organization_id: string; id: string }[];

  let failed = 0;
  for (const row of ended) {
    const sync = await syncOrganizationEntitlements(row.organization_id, 'expire_trials');
    if (!sync.ok) {
      // The status flip stands; the failed entitlement row is retried by
      // the reconcile job and reported by send_alerts.
      failed++;
      log.error('expire_trials: sync failed', {
        organizationId: row.organization_id,
        error: sync.error,
      });
      continue;
    }
    await appendAudit({
      actorType: 'system',
      actorId: null,
      organizationId: row.organization_id,
      action: 'subscription.trial_ended',
      targetType: 'subscription',
      targetId: row.id,
      after: { to: 'unpaid', reason: 'trial_elapsed' },
    });
  }

  if (ended.length) {
    log.info('expire_trials: trials ended', { count: ended.length, failed });
  }

  return { ended: ended.length, failed };
}
