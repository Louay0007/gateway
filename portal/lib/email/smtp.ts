/**
 * SMTP transport — Gmail (or any SMTP) via nodemailer.
 *
 * Env vars:
 *   SMTP_HOST  — smtp.gmail.com
 *   SMTP_PORT  — 587 (STARTTLS) or 465 (implicit TLS)
 *   SMTP_USER  — full Gmail address
 *   SMTP_PASS  — App Password (16-char, spaces stripped)
 *   SMTP_SECURE — "true" for port 465 implicit TLS; default false (STARTTLS on 587)
 *
 * Failure policy: throws on any SMTP error. Callers decide what that means.
 */

import nodemailer from 'nodemailer';
import type { EmailMessage, EmailResult, EmailTransport } from './types';
import { fromAddress } from './types';

export const smtpTransport: EmailTransport = {
  name: 'smtp',

  async send(message: EmailMessage): Promise<EmailResult> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '');
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS must all be set.');
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    const info = await transporter.sendMail({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

    return { id: info.messageId ?? null };
  },
};