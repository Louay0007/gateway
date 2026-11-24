/**
 * customer_quota_alerts — mail the customer before the 403 does.
 *
 * WHY THIS EXISTS. `send_alerts` watches the platform (collector lag, failed
 * entitlements) and mails ops. A customer's own account had no warning of
 * any kind: the first they heard about an empty pool was a request failing.
 * This job closes that loop for the one condition with a real, dated
 * consequence.
 *
 * THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY.
 *
 *   1. Read the org's preferences (no row = the defaults in 0051).
 *   2. Ask `nextQuotaAlert` — pure — whether a mail is owed.
 *   3. INSERT the ledger row FIRST, and only proceed if it was actually
 *      inserted.
 *   4. Send.
 *
 * Sending then recording means a crash between the two re-sends on the next
 * pass; recording then sending means a crash costs one mail. Between a
 * duplicate warning and a missing one, a missing one is the failure this
 * job exists to prevent, but a duplicate at 15-minute cadence is what gets
 * alerting muted — so the ledger write is the gate, and a send failure is
 * logged loudly rather than retried into a loop.
 *
 * IT IS ALSO CHEAP ON PURPOSE. One query for the orgs with a pool, one for
 * the preferences, one aggregate for usage. No per-org round trip, because
 * this runs beside the collector on a 2-vCPU box.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { sendEmail } from '@/lib/email';
import { logoAttachments, textToHtml, wrapEmail } from '@/lib/email/layout';
import { log } from '@/lib/log';
import {
  nextQuotaAlert,
  normalizeThresholds,
  type AlertKind,
} from '@/lib/dashboard/quota-alerts';
import { compact } from '@/lib/dashboard/format';

export interface CustomerQuotaAlertsResult {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface OrgRow {
  organization_id: string;
  name: string;
  email: string | null;
  pool_tokens: string | number | null;
  pool_used: string | number | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  quota_thresholds: unknown;
  on_exhausted: boolean | null;
  channel: string | null;
  already_sent: unknown;
}

function dateLabel(value: Date | string | null): string {
  if (!value) return 'your renewal date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'your renewal date';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function subjectFor(kind: AlertKind, pct: number): string {
  return kind === 'exhausted'
    ? '[Zaino AI] Your token pool is spent for this period'
    : `[Zaino AI] You have used ${pct}% of this period's tokens`;
}

function bodyFor(kind: AlertKind, pct: number, pool: number, used: number, end: Date | string | null): string {
  const resets = dateLabel(end);
  if (kind === 'exhausted') {
    return [
      'Your token pool is spent for this period.',
      '',
      `Every model on your plan is paused until renewal on ${resets}.`,
      'You can keep using the dashboard and your keys; inference resumes automatically at the new period.',
      '',
      'If you need to keep working now, upgrading adds a fresh pool immediately.',
      '',
      '—',
      'This mail is sent once per period. Turn it off in Settings → Notifications.',
    ].join('\n');
  }
  return [
    `You have used ${pct}% of this period's token pool.`,
    '',
    `Used: ${compact(used)} of ${compact(pool)} tokens`,
    `Resets: ${resets}`,
    '',
    'Nothing is paused yet. This is the warning that arrives before the one that matters.',
    '',
    '—',
    `This mail is sent once per threshold (${pct}%) per period. Turn it off in Settings → Notifications.`,
  ].join('\n');
}

/**
 * One pass. Exported for the job runner and for the "does it send at all"
 * check in `verify-metering`-style scripts.
 */
export async function runCustomerQuotaAlerts(): Promise<CustomerQuotaAlertsResult> {
  const result: CustomerQuotaAlertsResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  // One query: the org, its subscription window, its pool, its usage in that
  // window and its preferences. A LEFT JOIN on the prefs keeps "no row =
  // defaults" a property of the SQL rather than a second query per org.
  //
  // The owner join targets `users` (the DOMAIN table), not `auth_users`:
  // `organization_members.user_id` references the former, so joining the
  // auth identity would match nothing and every org would report "no owner
  // email" while looking correct.
  const rows = (await db.execute(sql`
    SELECT o.id            AS organization_id,
           o.name          AS name,
           u.email         AS email,
           COALESCE((SELECT SUM(value::bigint) FROM jsonb_each_text(p.token_limits)), 0) AS pool_tokens,
           COALESCE((
             SELECT SUM(
               (COALESCE(ur.fresh_input_tokens, ur.input_tokens - LEAST(ur.cache_read_tokens, ur.input_tokens))
                + COALESCE(ur.output_tokens, 0) * 5
                + (COALESCE(ur.cache_write_5m_tokens, 0) + COALESCE(ur.cache_write_1h_tokens, 0)) * 2
                + LEAST(COALESCE(ur.cache_read_tokens, 0), 64000) / 10)
               * (CASE ur.model WHEN 'fast' THEN 1 WHEN 'smart' THEN 3 WHEN 'frontier' THEN 15 WHEN 'fable' THEN 15 ELSE 3 END / 3.0)
             )
               FROM usage_records ur
              WHERE ur.organization_id = o.id
                AND ur.occurred_at >= s.current_period_start
                AND ur.occurred_at <  s.current_period_end
           ), 0) AS pool_used,
           s.current_period_start AS period_start,
           s.current_period_end   AS period_end,
           pref.quota_thresholds  AS quota_thresholds,
           pref.on_exhausted      AS on_exhausted,
           pref.channel           AS channel,
           COALESCE((
             SELECT array_agg(sent.threshold)
               FROM org_alert_sent sent
              WHERE sent.organization_id = o.id
                AND sent.period_start = s.current_period_start
           ), ARRAY[]::int[]) AS already_sent
      FROM organizations o
      JOIN subscriptions s ON s.organization_id = o.id
      JOIN plans p         ON p.id = s.plan_id
      LEFT JOIN org_alert_prefs pref ON pref.organization_id = o.id
      LEFT JOIN LATERAL (
        SELECT m.user_id FROM organization_members m
         WHERE m.organization_id = o.id AND m.role = 'owner'
         LIMIT 1
      ) owner ON TRUE
      LEFT JOIN users u ON u.id = owner.user_id
     WHERE o.status = 'active'
       AND o.deleted_at IS NULL
       AND s.status IN ('active', 'trialing', 'past_due')
       AND s.current_period_start IS NOT NULL
       AND s.current_period_end IS NOT NULL
  `)) as unknown as OrgRow[];

  for (const row of rows) {
    result.scanned++;
    try {
      const pool = Number(row.pool_tokens ?? 0);
      const used = Number(row.pool_used ?? 0);
      if (!(pool > 0)) {
        result.skipped++;
        continue;
      }

      // `channel = 'none'` is an explicit opt-out and wins over thresholds.
      if ((row.channel ?? 'email') === 'none') {
        result.skipped++;
        continue;
      }

      const thresholds = normalizeThresholds(row.quota_thresholds);
      const alreadySent = Array.isArray(row.already_sent)
        ? (row.already_sent as unknown[]).map((v) => Number(v)).filter((v) => Number.isInteger(v))
        : [];

      const decision = nextQuotaAlert({
        poolTokens: pool,
        poolUsedTokens: used,
        thresholds,
        onExhausted: row.on_exhausted ?? true,
        alreadySent,
      });
      if (!decision) {
        result.skipped++;
        continue;
      }

      // Claim the (org, period, threshold) BEFORE sending. If this insert
      // loses a race, someone already mailed it — skip rather than duplicate.
      const claimed = (await db.execute(sql`
        INSERT INTO org_alert_sent (organization_id, period_start, threshold)
        VALUES (${row.organization_id}::uuid, ${new Date(row.period_start!)}::timestamptz, ${decision.threshold})
        ON CONFLICT (organization_id, period_start, threshold) DO NOTHING
        RETURNING threshold
      `)) as unknown as { threshold: number }[];
      if (claimed.length === 0) {
        result.skipped++;
        continue;
      }

      if (!row.email) {
        // No owner address: the ledger row stays, so this is not retried
        // forever once a mail arrives. Logged because it is a real gap.
        log.warn('customer_quota_alerts: org has no owner email', {
          organizationId: row.organization_id,
        });
        result.skipped++;
        continue;
      }

      const text = bodyFor(decision.kind, decision.threshold, pool, used, row.period_end);
      await sendEmail({
        to: row.email,
        subject: subjectFor(decision.kind, decision.threshold),
        text,
        html: wrapEmail(textToHtml(text)),
        attachments: logoAttachments(),
      });
      result.sent++;
      log.info('customer_quota_alerts: sent', {
        organizationId: row.organization_id,
        kind: decision.kind,
        threshold: decision.threshold,
      });
    } catch (e) {
      result.failed++;
      log.error('customer_quota_alerts: org failed', {
        organizationId: row.organization_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
