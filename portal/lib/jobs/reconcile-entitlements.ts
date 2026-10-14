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
 * Two populations, deliberately different:
 *
 *   RETRY    pending/failed rows whose next_retry_at has arrived. This is
 *            the queue the admin console (A-09) reads and retries by
 *            hand; the job drains it automatically.
 *   BACKSTOP synced rows that have not been refreshed in an hour, which
 *            catches silent drift with no error anywhere.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { log } from '@/lib/log';

/** How long a `synced` row may go unrefreshed before we push it again. */
const BACKSTOP_INTERVAL_MINUTES = 60;

/** Bound one pass so a bad night cannot hold the lock indefinitely. */
const MAX_ORGS_PER_PASS = 100;

export interface ReconcileEntitlementsResult {
  scanned: number;
  synced: number;
  failed: number;
}

export async function reconcileEntitlements(): Promise<ReconcileEntitlementsResult> {
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
     ORDER BY e.next_retry_at ASC
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
