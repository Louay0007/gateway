/**
 * Branded email layout — wraps any message body in the Zaino AI shell.
 *
 * Every customer-facing and ops email goes through `wrapEmail()` before
 * delivery. The layout is inline-CSS only (no <style> blocks, no external
 * stylesheets) because Gmail, Outlook and Yahoo strip or ignore anything
 * else.
 *
 * THE LOGO IS EMBEDDED, NOT LINKED. The portal URL is not publicly
 * reachable in every environment, so a remote <img> shows as broken (the
 * exact bug this fixed). Instead the header uses `<img src="cid:...">`
 * and the PNG travels as an inline attachment via `logoAttachment()`.
 * Both transports (Resend, SMTP) forward attachments; the log transport
 * ignores them by design (dev only).
 *
 * Design: black header tile with the white curved-Z mark + "Zaino AI"
 * wordmark, clean white body, muted footer with support link. Matches the
 * portal's brand lockup (assets/logo/logo.tsx).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailAttachment } from './types';

const PORTAL_URL = 'https://zaino.soon.it';
export const SUPPORT_EMAIL = 'contact.zaino.ai@gmail.com';

/** CID referenced by the header <img>. Must match the attachment's contentId. */
export const LOGO_CID = 'zaino-logo';

let cachedLogo: EmailAttachment | null = null;

/**
 * The white curved-Z logo as an inline (CID) attachment. The file is
 * 22 KB — small enough to embed in every mail without bloating it.
 * Result is cached for the life of the process.
 */
export function logoAttachment(): EmailAttachment {
  if (cachedLogo) return cachedLogo;
  const content = readFileSync(
    join(process.cwd(), 'public/logo/zaino-curved-z-white.png'),
  ).toString('base64');
  cachedLogo = {
    filename: 'zaino-logo.png',
    content,
    contentType: 'image/png',
    contentId: LOGO_CID,
  };
  return cachedLogo;
}

export interface EmailLayoutOptions {
  /** Optional preheader text (hidden preview line in inbox). */
  preheader?: string;
  /** RTL direction for Arabic emails. */
  dir?: 'ltr' | 'rtl';
}

/**
 * Wrap a content block (HTML string) in the full Zaino email shell.
 * Returns a complete, self-contained HTML document ready for the `html`
 * field of an EmailMessage.
 */
export function wrapEmail(
  contentHtml: string,
  options: EmailLayoutOptions = {},
): string {
  const { preheader, dir = 'ltr' } = options;
  const align = dir === 'rtl' ? 'right' : 'left';
  const textAlign = dir === 'rtl' ? 'right' : 'left';

  return `<!DOCTYPE html>
<html lang="en" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zaino AI</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f5f5;">${preheader}</div>` : ''}
  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#000000;padding:24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align:${align};">
                    <a href="${PORTAL_URL}" target="_blank" style="text-decoration:none;">
                      <img src="cid:${LOGO_CID}" alt="Zaino AI" width="32" height="32" style="display:block;border:0;outline:none;text-decoration:none;" />
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;text-align:${textAlign};color:#1a1a1a;font-size:15px;line-height:1.6;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa;border-top:1px solid #eeeeee;padding:24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align:${textAlign};color:#888888;font-size:13px;line-height:1.5;">
                    <p style="margin:0 0 8px 0;">&copy; ${new Date().getFullYear()} Zaino AI. All rights reserved.</p>
                    <p style="margin:0;">
                      Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#000000;text-decoration:underline;">${SUPPORT_EMAIL}</a>
                      &nbsp;&middot;&nbsp;
                      <a href="${PORTAL_URL}" style="color:#000000;text-decoration:underline;">Dashboard</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Convert plain-text content into simple HTML paragraphs.
 * Handles newlines as <br> and preserves basic structure.
 */
export function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<br>';
      // Escape HTML entities
      const escaped = trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<p style="margin:0 0 12px 0;">${escaped}</p>`;
    })
    .join('\n');
}

/**
 * Build a styled CTA button as inline HTML.
 */
export function buttonHtml(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
  <tr>
    <td style="border-radius:8px;background-color:#000000;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">${label}</a>
    </td>
  </tr>
</table>`;
}

/**
 * Build a detail row (label: value) for transactional emails.
 */
export function detailRow(label: string, value: string): string {
  return `<tr>
  <td style="padding:6px 0;color:#666666;font-size:14px;width:140px;">${label}</td>
  <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:500;">${value}</td>
</tr>`;
}

/**
 * Build a details table wrapper.
 */
export function detailsTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;width:100%;">
  ${rows}
</table>`;
}