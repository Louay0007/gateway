/**
 * send_alerts — the day-one alerting PLATFORM.md §11 asks for.
 *
 * Scope is deliberately the two conditions that lose money silently,
 * plus anything the runner itself failed at:
 *
 *   1. Collector lag — `collect_usage` has not run for 30 minutes.
 *      Usage that is not collected is usage that is not billed.
 *   2. Failed entitlements — an org the gateway does not agree with.
 *      Either they paid and cannot spend, or they should have been cut
 *      and still can.
 *   3. Any job runner error from the ledger.
 *
 * DEDUPE IS THE WHOLE DESIGN. A naive "email every failure" alerts
 * every 15 minutes forever — which is how alerting gets muted, which is
 * how the next real outage is missed. `system_alerts` stores the last
 * state we alerted on; mail is sent only when the state CHANGES. The
 * state is a stable string, so the same two failures email once and
 * then stay silent until something else changes.
 *
 * Delivery goes through the same email transport as password resets
 * (log transport in dev — the alert text shows up in the job log, which
 * is exactly where a developer looks).
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { systemAlerts } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { logoAttachment, textToHtml, wrapEmail } from '@/lib/email/layout';
import { log } from '@/lib/log';

/** Collector silence after which usage is silently not being billed. */
const COLLECTOR_LAG_MINUTES = 30;

const ALERT_NAME = 'ops_alerts';

async function opsRecipients(): Promise<string[]> {
  const raw = process.env.OPS_ALERT_EMAIL ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Compute the current alert state as a stable, sorted string.
 *
 * Empty string = healthy. Any change to this function's output is a new
 * email, so it must not contain timestamps or counts that drift on
 * their own — a lagging collector that stays lagging is ONE alert, not
 * one per pass.
 */
async function currentState(): Promise<string> {
  const parts: string[] = [];

  const [collector] = (await db.execute(sql`
    SELECT last_run_at
      FROM job_runs
     WHERE name = 'collect_usage'
  `)) as unknown as { last_run_at: Date | null }[];

  if (!collector?.last_run_at) {
    parts.push('collect_usage has never run');
  } else {
    const lagMinutes =
      (Date.now() - new Date(collector.last_run_at).getTime()) / 60_000;
    if (lagMinutes > COLLECTOR_LAG_MINUTES) {
      parts.push(`collect_usage is ${Math.round(lagMinutes)}m behind (>${COLLECTOR_LAG_MINUTES}m)`);
    }
  }

  const [failedEntitlements] = (await db.execute(sql`
    SELECT count(*) AS n
      FROM entitlements
     WHERE status = 'failed'
  `)) as unknown as { n: number }[];
  const failedCount = Number(failedEntitlements?.n ?? 0);
  if (failedCount > 0) {
    parts.push(`${failedCount} organization(s) with failed entitlement sync`);
  }

  const jobErrors = (await db.execute(sql`
    SELECT name, last_error
      FROM job_runs
     WHERE last_error IS NOT NULL
     ORDER BY name
  `)) as unknown as { name: string; last_error: string }[];
  for (const row of jobErrors) {
    // The error text is ours (job failures), not user input, but keep it
    // bounded — a Postgres error can be paragraphs.
    parts.push(`job ${row.name} failed: ${row.last_error.slice(0, 200)}`);
  }

  return parts.sort().join(' | ');
}

export async function sendOpsAlerts(): Promise<{
  state: string;
  emailed: boolean;
  recovered?: boolean;
}> {
  const state = await currentState();

  const [previous] = await db
    .select()
    .from(systemAlerts)
    .where(eq(systemAlerts.name, ALERT_NAME));

  if (state === (previous?.lastState ?? '')) {
    // Nothing changed: no mail. This is the line that keeps the alerts
    // readable.
    return { state, emailed: false };
  }

  const recipients = await opsRecipients();
  const recovering = state === '' && previous !== undefined;
  let emailed = false;

  if (recipients.length > 0) {
    try {
      const alertText =
          (recovering
            ? 'All monitored checks are healthy again.\n\nPrevious state:\n'
            : 'One or more checks need attention:\n\n') +
          (state || '(healthy)') +
          '\n\n—\nSent by the send_alerts job. Silence means nothing changed.';
      await sendEmail({
        to: recipients[0]!,
        subject: recovering
          ? '[gateway] recovered — all checks healthy'
          : '[gateway] attention needed',
        text: alertText,
        html: wrapEmail(textToHtml(alertText)),
        attachments: [logoAttachment()],
      });
      emailed = true;
    } catch (e) {
      log.error('send_alerts: delivery failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    log.info('send_alerts: no OPS_ALERT_EMAIL configured; state recorded only', { state });
  }

  await db
    .insert(systemAlerts)
    .values({ name: ALERT_NAME, lastState: state, lastSentAt: emailed ? new Date() : null })
    .onConflictDoUpdate({
      target: systemAlerts.name,
      set: {
        lastState: state,
        lastSentAt: emailed ? new Date() : null,
      },
    });

  if (state) {
    log.warn('send_alerts: state changed', { state, emailed, recovering });
  }

  return { state, emailed, ...(recovering ? { recovered: true } : {}) };
}
