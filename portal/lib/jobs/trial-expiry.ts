/**
 * Trial expiry job — flips expired `trialing` subscriptions to `canceled`.
 *
 * Runs hourly via the jobs scheduler. When a trial's `trial_end` has passed,
 * the subscription status is set to `canceled` and entitlements are re-synced
 * so LiteLLM cuts access (budget → CUT_BUDGET, models → []).
 *
 * The existing entitlement sync already handles `canceled` → cut, so this
 * job only needs to flip the status; the next sync cycle (or the explicit
 * call here) propagates the change to the gateway.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

export async function runTrialExpiry(): Promise<{ expired: number; errors: number }> {
  const now = new Date();

  // Find all trialing subscriptions past their trial_end
  const expired = (await db.execute(sql`
    SELECT id, organization_id
      FROM subscriptions
     WHERE status = 'trialing'
       AND trial_end IS NOT NULL
       AND trial_end < ${now}
  `)) as unknown as { id: string; organization_id: string }[];

  if (expired.length === 0) {
    return { expired: 0, errors: 0 };
  }

  log.info('trial-expiry: found expired trials', { count: expired.length });

  let errors = 0;
  for (const row of expired) {
    try {
      await db
        .update(subscriptions)
        .set({ status: 'canceled', updatedAt: now })
        .where(sql`${subscriptions.id} = ${row.id}`);

      const sync = await syncOrganizationEntitlements(row.organization_id, 'trial_expired');
      if (!sync.ok) {
        log.warn('trial-expiry: entitlement sync failed after cancellation', {
          orgId: row.organization_id,
          error: sync.error,
        });
        errors++;
      }
    } catch (err) {
      log.error('trial-expiry: failed to cancel expired trial', {
        subId: row.id,
        orgId: row.organization_id,
        error: String(err),
      });
      errors++;
    }
  }

  log.info('trial-expiry: completed', { expired: expired.length, errors });
  return { expired: expired.length, errors };
}