/**
 * detect_anomalies — the money-risk signals send_alerts does not cover.
 *
 * send_alerts (0004) watches the SYSTEM: a lagging collector, a failed
 * entitlement push, a job error. This job watches the CUSTOMERS, for the
 * patterns that cost money quietly and are invisible in an individual
 * dashboard:
 *
 *   1. MULE PHONE — one sender phone paying for several different orgs.
 *      A real person has one account; a phone number across accounts is a
 *      reseller or a compromised proof relay. (`sender_phone` is not
 *      unique by design — a family may share a phone — so this is a
 *      REVIEW signal, not a block.)
 *
 *   2. REJECTED-PROOF BURST — an org with several rejected proofs in a
 *      day. Either a confused customer support should call, or someone
 *      fishing for an approval. (`d17.rejected` audit rows.)
 *
 *   3. HARD-CAP BREACH — an org whose customer cost for the current
 *      period already exceeds its plan's hard cap. This MUST be
 *      impossible: the gateway budget is set to hard_cap / multiplier.
 *      Seeing it means the limiter did not hold, which is a live money
 *      leak, not a billing curiosity.
 *
 *   4. LARGE SINGLE REQUEST — one request that cost more than a normal
 *      month. Usually a runaway prompt; sometimes a fat-fingered model
 *      id.
 *
 * Note on the signal NOT included: authorization-number reuse across
 * accounts is already impossible — `payments_d17.authorization_number` is
 * UNIQUE, so a second org cannot register the same transfer. The
 * constraint is the enforcement; alerting on it would alert on nothing.
 *
 * DEDUPE is per-finding, keyed by a stable name in `system_alerts`, so a
 * standing condition emails once and a cleared one emails a recovery.
 * Every pass sends at most TWO mails (a digest of new/changed findings,
 * and a digest of recoveries) — per-finding mail gets muted, and a muted
 * channel is a missing channel.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { systemAlerts } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { logoAttachment, textToHtml, wrapEmail } from '@/lib/email/layout';
import { log } from '@/lib/log';

/** Rejections in 24h before an org is worth a look. */
const DUPLICATE_PROOF_THRESHOLD = 3;
/** Customer cost (cents) of a single request that warrants a look. */
const LARGE_REQUEST_CENTS = 2500;

const PREFIX = 'anomaly:';

interface Finding {
  /** Stable dedupe key; also the system_alerts.name. */
  name: string;
  /** Human line for the digest. */
  message: string;
}

async function opsRecipients(): Promise<string[]> {
  return (process.env.OPS_ALERT_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function collectFindings(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // ── 1. One phone, several orgs ───────────────────────────────────────
  const phones = (await db.execute(sql`
    SELECT p.sender_phone AS phone,
           count(DISTINCT p.organization_id)::int AS orgs,
           string_agg(DISTINCT o.name, ', ') AS names
      FROM payments_d17 p
      JOIN organizations o ON o.id = p.organization_id
     WHERE p.sender_phone IS NOT NULL
       AND p.status IN ('proof_submitted', 'paid')
     GROUP BY p.sender_phone
    HAVING count(DISTINCT p.organization_id) > 1
  `)) as unknown as { phone: string; orgs: number; names: string }[];
  for (const r of phones) {
    findings.push({
      name: `${PREFIX}phone_reuse:${r.phone}`,
      message: `sender phone ${r.phone} paid for ${r.orgs} organizations (${r.names})`,
    });
  }

  // ── 2. Rejected-proof burst ──────────────────────────────────────────
  const bursts = (await db.execute(sql`
    SELECT a.organization_id AS org_id, o.name AS org_name, count(*)::int AS n
      FROM audit_log a
      JOIN organizations o ON o.id = a.organization_id
     WHERE a.action = 'd17.rejected'
       AND a.created_at > now() - interval '24 hours'
     GROUP BY a.organization_id, o.name
    HAVING count(*) >= ${DUPLICATE_PROOF_THRESHOLD}
  `)) as unknown as { org_id: string; org_name: string; n: number }[];
  for (const r of bursts) {
    findings.push({
      name: `${PREFIX}rejected_burst:${r.org_id}`,
      message: `${r.org_name} (${r.org_id}) had ${r.n} rejected D17 proofs in 24h`,
    });
  }

  // ── 3. Hard-cap breach (the limiter did not hold) ────────────────────
  const breaches = (await db.execute(sql`
    SELECT ur.organization_id AS org_id, o.name AS org_name,
           sum(ur.cost_customer_usd)::float8 AS cost_usd,
           p.hard_cap_cents AS cap_cents
      FROM usage_records ur
      JOIN subscriptions s
        ON s.organization_id = ur.organization_id
       AND s.status IN ('active', 'past_due', 'paused')
      JOIN plans p ON p.id = s.plan_id
      JOIN organizations o ON o.id = ur.organization_id
     WHERE p.hard_cap_cents IS NOT NULL
       AND ur.occurred_at >= COALESCE(s.current_period_start, date_trunc('month', now()))
     GROUP BY ur.organization_id, o.name, p.hard_cap_cents
    HAVING sum(ur.cost_customer_usd) * 100 > p.hard_cap_cents
  `)) as unknown as { org_id: string; org_name: string; cost_usd: number; cap_cents: number }[];
  for (const r of breaches) {
    findings.push({
      name: `${PREFIX}cap_breach:${r.org_id}`,
      message: `${r.org_name} (${r.org_id}) spent $${Number(r.cost_usd).toFixed(2)} against a $${(Number(r.cap_cents) / 100).toFixed(2)} hard cap — gateway limiter did not hold`,
    });
  }

  // ── 4. A single very large request ───────────────────────────────────
  const big = (await db.execute(sql`
    SELECT ur.id AS usage_id, ur.organization_id AS org_id, o.name AS org_name,
           ur.model, ur.cost_customer_usd::float8 AS cost_usd
      FROM usage_records ur
      JOIN organizations o ON o.id = ur.organization_id
     WHERE ur.occurred_at > now() - interval '24 hours'
       AND ur.cost_customer_usd * 100 >= ${LARGE_REQUEST_CENTS}
     ORDER BY ur.cost_customer_usd DESC
     LIMIT 50
  `)) as unknown as {
    usage_id: number;
    org_id: string;
    org_name: string;
    model: string;
    cost_usd: number;
  }[];
  for (const r of big) {
    findings.push({
      name: `${PREFIX}large_request:${r.usage_id}`,
      message: `${r.org_name} (${r.org_id}) had a single ${r.model} request costing $${Number(r.cost_usd).toFixed(2)}`,
    });
  }

  return findings.sort((a, b) => a.name.localeCompare(b.name));
}

export async function detectAnomalies(): Promise<{
  findings: number;
  newOrChanged: number;
  recovered: number;
  emailed: boolean;
}> {
  const findings = await collectFindings();
  const current = new Map(findings.map((f) => [f.name, f]));

  const existing = await db
    .select()
    .from(systemAlerts)
    .where(sql`${systemAlerts.name} LIKE ${PREFIX + '%'}`);

  const newOrChanged: Finding[] = [];
  for (const f of findings) {
    const prev = existing.find((e) => e.name === f.name);
    if (!prev || prev.lastState !== f.message) newOrChanged.push(f);
  }
  const recovered = existing.filter((e) => !current.has(e.name));

  // Persist the new state for every current finding (cheap upsert), so a
  // repeated pass is silent.
  for (const f of findings) {
    await db
      .insert(systemAlerts)
      .values({ name: f.name, lastState: f.message })
      .onConflictDoUpdate({
        target: systemAlerts.name,
        set: { lastState: f.message },
      });
  }
  for (const r of recovered) {
    await db.delete(systemAlerts).where(sql`${systemAlerts.name} = ${r.name}`);
  }

  const recipients = await opsRecipients();
  let emailed = false;

  if ((newOrChanged.length || recovered.length) && recipients.length > 0) {
    const sections: string[] = [];
    if (newOrChanged.length) {
      sections.push(
        `${newOrChanged.length} signal(s) need attention:\n` +
          newOrChanged.map((f) => `  • ${f.message}`).join('\n'),
      );
    }
    if (recovered.length) {
      sections.push(
        `${recovered.length} signal(s) cleared:\n` +
          recovered.map((r) => `  • ${r.lastState}`).join('\n'),
      );
    }
    try {
      const alertText = sections.join('\n\n') + '\n\n—\nSent by the detect_anomalies job.';
      await sendEmail({
        to: recipients[0]!,
        subject: newOrChanged.length
          ? '[gateway] anomaly signals need attention'
          : '[gateway] anomaly signals cleared',
        text: alertText,
        html: wrapEmail(textToHtml(alertText)),
        attachments: [logoAttachment()],
      });
      emailed = true;
    } catch (e) {
      log.error('detect_anomalies: delivery failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (newOrChanged.length || recovered.length) {
    log.warn('detect_anomalies: state changed', {
      findings: findings.length,
      newOrChanged: newOrChanged.length,
      recovered: recovered.length,
      emailed,
    });
  }

  return {
    findings: findings.length,
    newOrChanged: newOrChanged.length,
    recovered: recovered.length,
    emailed,
  };
}
