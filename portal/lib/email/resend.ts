/**
 * Resend transport — the real one.
 *
 * REST only: POST https://api.resend.com/emails. No SDK (see types.ts).
 *
 * Failure policy: this transport THROWS on a non-2xx. Callers decide
 * what that means — the password-reset request route must still answer
 * 200 to the user (the failure is logged; the account's existence is not
 * the user's business), while an ops alert simply fails the job loudly.
 */

import type { EmailMessage, EmailResult, EmailTransport } from './types';
import { fromAddress } from './types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const resendTransport: EmailTransport = {
  name: 'resend',

  async send(message: EmailMessage): Promise<EmailResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY is not set — cannot send email.');
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await res.json().catch(() => null)) as { id?: string } | null;

    if (!res.ok) {
      // Provider error text can echo recipient addresses; keep the
      // status and log the rest, not the body, in most cases.
      throw new Error(`Resend → ${res.status}`);
    }

    return { id: body?.id ?? null };
  },
};
