/**
 * D17 email templates — customer and ops notifications.
 *
 * Templates live here, keys live in the i18n dictionary
 * (lib/i18n/d17.ts), because "the same words in three languages" is a
 * translation problem, not a string-concatenation one. Delivery goes
 * through the shared transport (lib/email) — the log transport in dev,
 * Resend with a key. No SMS provider is configured, so the brief's
 * "email/SMS" is email today; the transport seam is where SMS would go.
 */

import { t17, type D17Lang } from '@/lib/i18n/d17';

export interface D17EmailVars {
  plan?: string;
  amount?: string;
  auth?: string;
  hours?: string;
  reason?: string;
  org?: string;
  phone?: string;
  submittedAt?: string;
}

export interface D17EmailTemplates {
  receivedSubject(v: D17EmailVars): string;
  receivedBody(v: D17EmailVars): string;
  approvedSubject(v: D17EmailVars): string;
  approvedBody(v: D17EmailVars): string;
  rejectedSubject(v: D17EmailVars): string;
  rejectedBody(v: D17EmailVars): string;
  adminSubject(v: D17EmailVars): string;
  adminBody(v: D17EmailVars): string;
}

function vars(lang: D17Lang, key: string, input: D17EmailVars): string {
  return t17(lang, key, {
    plan: input.plan ?? '',
    amount: input.amount ?? '',
    auth: input.auth ?? '',
    hours: input.hours ?? '24',
    reason: input.reason ?? '',
    org: input.org ?? '',
    phone: input.phone ?? '',
    submittedAt: input.submittedAt ?? '',
  });
}

export function d17EmailTemplates(lang: D17Lang): D17EmailTemplates {
  return {
    receivedSubject: (v) => vars(lang, 'd17.email_received_subject', v),
    receivedBody: (v) => vars(lang, 'd17.email_received_body', v),
    approvedSubject: (v) => vars(lang, 'd17.email_approved_subject', v),
    approvedBody: (v) => vars(lang, 'd17.email_approved_body', v),
    rejectedSubject: (v) => vars(lang, 'd17.email_rejected_subject', v),
    rejectedBody: (v) => vars(lang, 'd17.email_rejected_body', v),
    adminSubject: (v) => vars(lang, 'd17.notify_admin_subject', v),
    adminBody: (v) => vars(lang, 'd17.notify_admin_body', v),
  };
}
