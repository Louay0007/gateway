/**
 * Email transport — one seam, two implementations.
 *
 * WHY A SEAM: the money/auth flows that send mail (password reset today,
 * receipts when the payment provider lands) must be testable and runnable
 * before a provider account exists. Same shape as lib/billing: the
 * contract lives here, the provider specifics live in their own file,
 * and nothing above this line knows which one is live.
 *
 * WHY fetch AND NOT AN SDK: the Resend API is one POST with a bearer
 * token. An SDK would add a dependency to a money path for four lines
 * of fetch. If the provider changes, only resend.ts changes.
 *
 * Selection (EMAIL_TRANSPORT env, defaulting by what is configured):
 *   resend — real delivery, needs RESEND_API_KEY
 *   log    — writes the message to the structured log. DEV ONLY: the
 *            message body contains the reset link, and this transport
 *            exists so the flow is exercisable without a mail account.
 */

export interface EmailAttachment {
  /** File name shown to the client, e.g. `logo.png`. */
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  /** MIME type, e.g. `image/png`. Helps clients render inline images. */
  contentType?: string;
  /** CID used as `<img src="cid:...">` for inline embedding. */
  contentId?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailResult {
  /** Provider message id, when there is one. */
  id: string | null;
}

export interface EmailTransport {
  readonly name: 'resend' | 'log' | 'smtp';
  send(message: EmailMessage): Promise<EmailResult>;
}

/** From address, with a sane local fallback. */
export function fromAddress(): string {
  return process.env.MAIL_FROM ?? 'Zaino <contact.zaino.ai@gmail.com>';
}
