/**
 * Transport selection — the one place the environment picks a mail path.
 *
 * EMAIL_TRANSPORT wins when set; otherwise the presence of
 * RESEND_API_KEY decides. That makes local development zero-config
 * (log transport) and production a single env var.
 *
 * Importing this module is how everything else sends mail; nothing above
 * it knows which transport is live.
 */

import { logTransport } from './log';
import { resendTransport } from './resend';
import { smtpTransport } from './smtp';
import type { EmailMessage, EmailResult, EmailTransport } from './types';

function select(): EmailTransport {
  const requested = (process.env.EMAIL_TRANSPORT ?? '').toLowerCase();
  if (requested === 'log') return logTransport;
  if (requested === 'resend') return resendTransport;
  if (requested === 'smtp') return smtpTransport;
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return smtpTransport;
  return process.env.RESEND_API_KEY ? resendTransport : logTransport;
}

export const emailTransport: EmailTransport = select();

/** Send one message through the configured transport. */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  return emailTransport.send(message);
}

export type { EmailMessage, EmailResult, EmailTransport };
