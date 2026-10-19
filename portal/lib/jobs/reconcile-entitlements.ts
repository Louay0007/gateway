/**
 * Entitlement reconcile — Phase 5 groundwork, runnable from Phase 3.
 *
 * syncOrganizationEntitlements() is called from the paths that CHANGE an
 * entitlement: a webhook, a plan edit, a suspension. Those are all
 * event-driven, and event-driven means they eventually get lost — a
 * webhook that 500s after Stripe marked it delivered, a plan edited in
 * the admin console, a portal restart between "cached the intent" and
 * "pushed it". The result is an org whose dashboard says one thing and
 * whose gateway enforces another, which is exactly the drift nobody
 * notices until a customer is billed for access they should not have.
 *
 * So this job is the backstop: pick up every org whose cached entitlement
 * is out of date and push it again. It is idempotent, so running it
 * hourly against everyone is cheaper than the alternative.
 *
 * Three populations, deliberately different:
 *
 *   RETRY    pending/failed rows whose next_retry_at has arrived. This is
 *            the queue the admin console (A-09) reads and retries by
 *            hand; the job drains it automatically.
 *   BACKSTOP synced rows that have not been refreshed in an hour, which
 *            catches silent drift with no error anywhere.
 *   ORPHAN   organizations with NO entitlement row at all.
 *
 * The third one exists because the first two both start `FROM
 * entitlements`, which made this job structurally blind to the one state
 * that mattered most. If a subscription row is removed by any route that
 * does not itself call sync — a direct DELETE, a restore from a dump, an
 * operator mistake — the org's entitlement is emptied along with it (it is
 * FK'd to the org) and every key keeps whatever budget the gateway already
 * had. The reconciler could not see the org to cut it: the row it would
 * have looked for is the row that disappeared. Observed live — a billing
 * wipe left two keys holding live budgets on an org with no subscription.
 *
 * Deleting a subscription is supposed to go through cancel/deleteAccount,
 * and both of those sync. This population is the net for the routes that
 * do not.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

/** How long a `synced` row may go unrefreshed before we push it again. */
const BACKSTOP_INTERVAL_MINUTES = 60;

/** Bound one pass so a bad night cannot hold the lock indefinitely. */
const MAX_ORGS_PER_PASS = 100;

/**
 * How far back to look for orgs with no entitlement row.
 *
 * Bounded on purpose: an org that has been around longer than this and
 * still has no entitlement has simply never subscribed, and re-syncing
 * every historical org on every pass is work with no purpose. The window
 * comfortably covers the incident that motivated it — a subscription
 * removed during a wipe or a restore, noticed the same day.
 *
 * A no-subscription org stays in this population for the whole window and
 * is re-cut on every pass, because `syncOrganizationEntitlements` answers
 * "no subscription" with `forceCut` and writes no row to record that it
 * did. That is deliberate repetition over silent omission: the cut is
 * idempotent and cheap, and the alternative is the exact failure this
 * population exists to catch — an org the job can no longer see, holding
 * live gateway budgets. The population is bounded by MAX_ORGS_PER_PASS and
 * by the lookback, so the cost cannot grow without limit.
 */
const ORPHAN_LOOKBACK_DAYS = 30;

export interface ReconcileEntitlementsResult {
  scanned: number;
  synced: number;
  failed: number;
}

export async function reconcileEntitlements(): Promise<ReconcileEntitlementsResult> {
  // The two entitlement-rooted populations first, then the orphan sweep —
  // de-duplicated, because an org can only be missing its row or be due for
  // a refresh, but the UNION is written not to care.
  const due = (await db.execute(sql`
    SELECT e.organization_id
      FROM entitlements e
      JOIN organizations o ON o.id = e.organization_id
     WHERE o.status IN ('active', 'suspended')
       AND (
         (e.status IN ('pending', 'failed')
            AND e.next_retry_at <= now())
         OR (e.status = 'synced'
            AND (e.synced_at IS NULL
                 OR e.synced_at < now() - (${BACKSTOP_INTERVAL_MINUTES} * interval '1 minute')))
       )

    UNION

    SELECT o.id AS organization_id
      FROM organizations o
     WHERE o.status IN ('active', 'suspended')
       AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.organization_id = o.id)
       AND o.created_at > now() - (${ORPHAN_LOOKBACK_DAYS} * interval '1 day')

     ORDER BY 1 ASC
     LIMIT ${MAX_ORGS_PER_PASS}
  `)) as unknown as { organization_id: string }[];

  const result: ReconcileEntitlementsResult = {
    scanned: due.length,
    synced: 0,
    failed: 0,
  };

  for (const row of due) {
    try {
      const sync = await syncOrganizationEntitlements(
        row.organization_id,
        'reconcile-entitlements',
      );
      if (sync.ok) {
        result.synced++;
      } else {
        result.failed++;
        log.warn('entitlement reconcile left an org unsynced', {
          organizationId: row.organization_id,
          error: sync.error,
        });
      }
    } catch (e) {
      // sync() normally reports failure by return value; a throw means
      // something below it broke (usually Postgres). One org must not end
      // the pass — the rest still need their push.
      result.failed++;
      log.error('entitlement reconcile threw', {
        organizationId: row.organization_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
