/**
 * The alerting contract is wired, not just written.
 *
 * A rule that is correct and never called is the most expensive kind of
 * dead code: it reads as a feature in review. These assertions check the
 * three places that have to agree — the migration's defaults, the job that
 * reads them, and the switch the customer flips.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('customer quota alerts are wired end to end', () => {
  it('ships a migration for the preferences and the sent ledger', () => {
    const sql = read('db/migrations/0051_org_alert_prefs.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS org_alert_prefs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS org_alert_sent');
    // The dedupe is the feature; without this primary key the job mails
    // every 15 minutes forever.
    expect(sql).toMatch(/PRIMARY KEY \(organization_id, period_start, threshold\)/);
    // A threshold of 0 would fire constantly; the CHECK is what stops it at
    // the data layer rather than trusting every writer.
    expect(sql).toMatch(/t < 1 OR t > 100/);
  });

  it('registers the job in the runner', () => {
    const runner = read('scripts/jobs.ts');
    expect(runner).toContain("name: 'customer_quota_alerts'");
    expect(runner).toContain('runCustomerQuotaAlerts');
  });

  it('keeps ops alerting independent of customer preference', () => {
    // A customer mail failing must never suppress the platform alert, so
    // the two are separate registered jobs rather than one function.
    const runner = read('scripts/jobs.ts');
    expect(runner).toContain("name: 'send_alerts'");
    const job = read('lib/jobs/customer-quota-alerts.ts');
    expect(job).not.toContain('OPS_ALERT_EMAIL');
  });

  it('has a route and a settings tab for the preference', () => {
    expect(existsSync(resolve(ROOT, 'app/api/notifications/route.ts'))).toBe(true);
    const panel = read('components/settings/settings-panel.tsx');
    expect(panel).toContain('"notifications"');
    expect(panel).toContain('<NotificationsCard />');
    const tabs = read('components/settings/settings-tabs.tsx');
    expect(tabs).toContain('["notifications", "Notifications"]');
  });

  it('claims the ledger BEFORE sending, so a crash does not duplicate', () => {
    const job = read('lib/jobs/customer-quota-alerts.ts');
    const insertAt = job.indexOf('INSERT INTO org_alert_sent');
    const sendAt = job.indexOf('await sendEmail(');
    expect(insertAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(insertAt);
    expect(job).toContain('ON CONFLICT (organization_id, period_start, threshold) DO NOTHING');
  });

  it('joins the DOMAIN users table for the owner address', () => {
    // organization_members.user_id references `users`, not `auth_users`;
    // the wrong join matches nothing and every org reports "no owner email".
    const job = read('lib/jobs/customer-quota-alerts.ts');
    const sqlPart = job.slice(job.indexOf('SELECT o.id'), job.indexOf('`)) as unknown'));
    expect(sqlPart).toContain('LEFT JOIN users u ON u.id = owner.user_id');
    expect(sqlPart).not.toContain('auth_users');
  });
});
