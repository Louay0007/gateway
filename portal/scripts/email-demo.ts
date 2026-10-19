/**
 * email-demo — send the full set of branded email templates to one
 * recipient for visual QA.
 *
 *   node --experimental-transform-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/email-demo.ts [recipient@example.com]
 *
 * Renders every email type through the real layout (lib/email/layout.ts)
 * and the real i18n templates, then POSTs each via the Resend API. The
 * RESEND_API_KEY is read from the repo-root .env (where it is commented
 * out) so this script never has to mutate the environment file.
 *
 * Usage without sending: add --html to write the rendered HTML files
 * to /tmp instead of delivering them.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buttonHtml, logoAttachment, textToHtml, wrapEmail } from '@/lib/email/layout';
import { d17EmailTemplates } from '@/lib/email/d17-templates';

const TO = process.argv[2] ?? 'louay.rjilii@gmail.com';
const HTML_ONLY = process.argv.includes('--html');
const FROM = process.env.MAIL_FROM ?? 'Zaino AI <noreply@zaino.ai>';
const RESEND = 'https://api.resend.com/emails';

/** Read the (commented-out) key from the repo-root .env without unsetting it. */
function resendKey(): string {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  const m = env.match(/^\s*#?\s*RESEND_API_KEY=(\S+)/m);
  if (!m) throw new Error('RESEND_API_KEY not found in .env');
  return m[1]!;
}

interface Demo {
  name: string;
  subject: string;
  text: string;
  html: string;
}

const HOUR_LINK = 'https://zaino.soon.it/verify-email?token=demo-token-abc123';
const MIN_LINK = 'https://zaino.soon.it/reset-password?token=demo-token-xyz789';

const demos: Demo[] = [
  {
    name: '01-verify-email',
    subject: 'Confirm your email address',
    text:
      `Welcome to Zaino AI.\n\n` +
      `Confirm this address to finish setting up your account (the link is valid 1 hours):\n` +
      `${HOUR_LINK}\n\n` +
      `Until it is confirmed you can browse the dashboard, but you cannot ` +
      `create an API key or start a subscription.\n\n` +
      `If you did not create this account, you can ignore this email.`,
    html: wrapEmail(
      `<p style="margin:0 0 12px 0;">Welcome to Zaino AI.</p>` +
        `<p style="margin:0 0 12px 0;">Confirm this address to finish setting up your account (the link is valid 1 hours):</p>` +
        buttonHtml(HOUR_LINK, 'Confirm Email Address') +
        `<p style="margin:0 0 12px 0;">Until it is confirmed you can browse the dashboard, but you cannot create an API key or start a subscription.</p>` +
        `<p style="margin:0;color:#666666;font-size:13px;">If you did not create this account, you can ignore this email.</p>`,
    ),
  },
  {
    name: '02-password-reset',
    subject: 'Reset your password',
    text:
      `We received a request to reset the password for ${TO}.\n\n` +
      `Open this link to choose a new password (valid 30 minutes):\n` +
      `${MIN_LINK}\n\n` +
      `If you did not request a reset, you can ignore this email — your ` +
      `password stays as it is, and this link stops working on its own.`,
    html: wrapEmail(
      `<p style="margin:0 0 12px 0;">We received a request to reset the password for <strong>${TO}</strong>.</p>` +
        `<p style="margin:0 0 12px 0;">Open this link to choose a new password (valid 30 minutes):</p>` +
        buttonHtml(MIN_LINK, 'Reset Password') +
        `<p style="margin:0;color:#666666;font-size:13px;">If you did not request a reset, you can ignore this email — your password stays as it is, and this link stops working on its own.</p>`,
    ),
  },
  {
    name: '03-d17-received-fr',
    subject: d17EmailTemplates('fr').receivedSubject({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' }),
    text: d17EmailTemplates('fr').receivedBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' }),
    html: wrapEmail(textToHtml(d17EmailTemplates('fr').receivedBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' }))),
  },
  {
    name: '04-d17-received-ar',
    subject: d17EmailTemplates('ar').receivedSubject({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' }),
    text: d17EmailTemplates('ar').receivedBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' }),
    html: wrapEmail(textToHtml(d17EmailTemplates('ar').receivedBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', hours: '24' })), { dir: 'rtl' }),
  },
  {
    name: '05-d17-approved-fr',
    subject: d17EmailTemplates('fr').approvedSubject({ plan: 'Scale', amount: '40.000' }),
    text: d17EmailTemplates('fr').approvedBody({ plan: 'Scale', amount: '40.000' }),
    html: wrapEmail(textToHtml(d17EmailTemplates('fr').approvedBody({ plan: 'Scale', amount: '40.000' }))),
  },
  {
    name: '06-d17-rejected-fr',
    subject: d17EmailTemplates('fr').rejectedSubject({}),
    text: d17EmailTemplates('fr').rejectedBody({ amount: '40.000', reason: 'The authorization number does not match our records — please re-check the receipt from your transfer SMS and resubmit.' }),
    html: wrapEmail(textToHtml(d17EmailTemplates('fr').rejectedBody({ amount: '40.000', reason: 'The authorization number does not match our records — please re-check the receipt from your transfer SMS and resubmit.' }))),
  },
  {
    name: '07-d17-ops-admin',
    subject: d17EmailTemplates('fr').adminSubject({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910' }),
    text: d17EmailTemplates('fr').adminBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', org: 'Acme Tunis', phone: '+216 22 333 444', submittedAt: new Date().toISOString() }),
    html: wrapEmail(textToHtml(d17EmailTemplates('fr').adminBody({ plan: 'Scale', amount: '40.000', auth: 'D17-8842910', org: 'Acme Tunis', phone: '+216 22 333 444', submittedAt: new Date().toISOString() }))),
  },
  {
    name: '08-ops-alert-attention',
    subject: '[gateway] attention needed',
    text:
      'One or more checks need attention:\n\n' +
      'collect_usage is 47m behind (>30m) | 1 organization(s) with failed entitlement sync | job collect_usage failed: connection terminated\n\n' +
      '—\nSent by the send_alerts job. Silence means nothing changed.',
    html: wrapEmail(textToHtml(
      'One or more checks need attention:\n\n' +
      'collect_usage is 47m behind (>30m) | 1 organization(s) with failed entitlement sync | job collect_usage failed: connection terminated\n\n' +
      '—\nSent by the send_alerts job. Silence means nothing changed.',
    )),
  },
  {
    name: '09-ops-alert-recovered',
    subject: '[gateway] recovered — all checks healthy',
    text:
      'All monitored checks are healthy again.\n\nPrevious state:\n' +
      'collect_usage is 47m behind (>30m)\n\n' +
      '—\nSent by the send_alerts job. Silence means nothing changed.',
    html: wrapEmail(textToHtml(
      'All monitored checks are healthy again.\n\nPrevious state:\n' +
      'collect_usage is 47m behind (>30m)\n\n' +
      '—\nSent by the send_alerts job. Silence means nothing changed.',
    )),
  },
  {
    name: '10-ops-anomaly',
    subject: '[gateway] anomaly signals need attention',
    text:
      '3 signal(s) need attention:\n' +
      '  • sender phone +216 22 333 444 paid for 2 organizations (Acme Tunis, Beta Sfax)\n' +
      '  • Acme Tunis (0d2a) had 3 rejected D17 proofs in 24h\n' +
      '  • Beta Sfax (71c9) had a single gpt-4o request costing $31.40\n\n' +
      '—\nSent by the detect_anomalies job.',
    html: wrapEmail(textToHtml(
      '3 signal(s) need attention:\n' +
      '  • sender phone +216 22 333 444 paid for 2 organizations (Acme Tunis, Beta Sfax)\n' +
      '  • Acme Tunis (0d2a) had 3 rejected D17 proofs in 24h\n' +
      '  • Beta Sfax (71c9) had a single gpt-4o request costing $31.40\n\n' +
      '—\nSent by the detect_anomalies job.',
    )),
  },
];

async function main(): Promise<void> {
  if (HTML_ONLY) {
    mkdirSync('/tmp/zaino-email-demo', { recursive: true });
    for (const d of demos) {
      const path = `/tmp/zaino-email-demo/${d.name}.html`;
      writeFileSync(path, d.html, 'utf8');
      console.log(`wrote ${path}`);
    }
    return;
  }

  const key = resendKey();
  let ok = 0;
  let failed = 0;

  for (const d of demos) {
    const res = await fetch(RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `[demo] ${d.subject}`,
        text: d.text,
        html: d.html,
        attachments: [
          {
            content: logoAttachment().content,
            filename: logoAttachment().filename,
            content_type: 'image/png',
            content_id: 'zaino-logo',
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (res.ok) {
      ok += 1;
      console.log(`✔ ${d.name}  ${d.subject}  (id ${body?.id ?? '?'})`);
    } else {
      failed += 1;
      console.error(`✘ ${d.name}  ${d.subject}  → ${res.status} ${body?.message ?? ''}`);
    }
  }

  console.log(`\n${ok} sent, ${failed} failed → ${TO}`);
  if (failed) {
    console.error(
      'Hint: Resend rejects a sender domain that is not verified for the API key ' +
      '(check https://resend.com/domains), and free-tier keys cannot send to ' +
      'unverified recipients.',
    );
    process.exitCode = 1;
  }
}

await main();
