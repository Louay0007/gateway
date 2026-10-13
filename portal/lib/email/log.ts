/**
 * Log transport — development stand-in that never sends.
 *
 * Writes the message to the structured log at `info` with a `dev email`
 * marker so it is greppable and nobody mistakes it for delivery. The
 * reset link is logged in full ON PURPOSE: this transport exists so the
 * reset flow is exercisable without a mail account, and a link nobody
 * can read makes the flow untestable. It must never be selected in an
 * environment where real users exist.
 */

import { log } from '@/lib/log';
import type { EmailMessage, EmailResult, EmailTransport } from './types';

export const logTransport: EmailTransport = {
  name: 'log',

  async send(message: EmailMessage): Promise<EmailResult> {
    log.info('dev email (not delivered — log transport)', {
      transport: 'log',
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
    return { id: null };
  },
};
