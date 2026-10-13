/**
 * D17 proof submission — the customer-facing half of manual payment.
 *
 * Everything here is defensive on purpose: the person submitting is
 * telling us, over the internet, that they sent money. The only facts
 * we accept are (a) what THEY typed (an authorization number and a
 * phone) and (b) what our own database already knew (the amount). The
 * amount is NEVER read from the request — there is no amount field to
 * send.
 *
 * Order of operations, and why:
 *
 *   1. Load the payment for THIS subscription. A payment row only
 *      exists if a checkout created one, so a fabricated subscription
 *      id finds nothing.
 *   2. Window check. A proof submitted after the deadline is refused
 *      (and the row expired), so an old authorization number cannot
 *      activate a plan months later.
 *   3. Normalize + validate the authorization number against the
 *      CONFIGURABLE pattern.
 *   4. Duplicate check against every other row — one transfer pays one
 *      subscription. The unique index is the race-safe backstop; this
 *      check exists to give a friendly message and an audit trail.
 *   5. Rate limit, per IP and per subscription (the existing throttle).
 *   6. Screenshot, if any: content-typed, EXIF-stripped, randomized
 *      filename, outside the web root.
 *   7. Review flag: one phone submitting proofs for many subscriptions
 *      inside a short window is either a reseller or a farm.
 *   8. Write, then notify (customer first, ops second).
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  organizationMembers,
  organizations,
  paymentsD17,
  plans,
  subscriptions,
  users,
} from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { d17EmailTemplates } from '@/lib/email/d17-templates';
import { recordSubmission } from './d17-ratelimit';
import { log } from '@/lib/log';
import {
  SCREENSHOT_MAX_BYTES,
  authNumberPattern,
  detectScreenshotType,
  d17UploadsDir,
  formatTndMillimes,
  isValidAuthNumber,
  normalizeAuthNumber,
  normalizeSenderPhone,
  reviewFlagThreshold,
  reviewWindowMinutes,
} from './d17-config';

export type D17ProofErrorCode =
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'upstream'
  | 'internal';

export class D17ProofError extends Error {
  constructor(readonly code: D17ProofErrorCode, message: string) {
    super(message);
    this.name = 'D17ProofError';
  }
}

export interface SubmitProofInput {
  subscriptionId: string;
  organizationId: string;
  authorizationNumber: string;
  senderPhone: string;
  /** Optional. Validated by content; re-encoded; EXIF stripped. */
  screenshot: File | null;
  ip: string | null;
  userAgent: string | null;
  lang?: 'fr' | 'ar' | 'en';
}

export interface SubmitProofResult {
  paymentId: string;
  flaggedReview: boolean;
}

/** Strip metadata by re-encoding: sharp never copies EXIF unless told to. */
async function storeScreenshot(file: File): Promise<string | null> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > SCREENSHOT_MAX_BYTES) {
    throw new D17ProofError('validation', 'screenshot_too_large');
  }

  const type = detectScreenshotType(bytes);
  if (!type) {
    throw new D17ProofError('validation', 'screenshot_type');
  }

  let stored: Buffer;
  try {
    const sharp = (await import('sharp')).default;
    stored = await sharp(bytes)
      // Cap the long edge: a 12-megapixel screenshot is 4 MB of EXIF
      // and GPS nobody needs, and re-encoding drops the metadata.
      .resize({ width: 1600, withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new D17ProofError('validation', 'screenshot_unreadable');
  }

  const dir = d17UploadsDir();
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.png`;
  await writeFile(`${dir}/${name}`, stored, { mode: 0o640 });

  return name;
}

/** How many OTHER subscriptions this phone submitted proofs for, recently. */
async function recentProofsFromPhone(
  senderPhone: string,
  excludePaymentId: string,
): Promise<number> {
  const windowMinutes = reviewWindowMinutes();
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(paymentsD17)
    .where(
      and(
        eq(paymentsD17.senderPhone, senderPhone),
        ne(paymentsD17.id, excludePaymentId),
        sql`${paymentsD17.submittedAt} > now() - (${windowMinutes} * interval '1 minute')`,
      ),
    );
  return Number(row?.n ?? 0);
}

export async function submitD17Proof(
  input: SubmitProofInput,
): Promise<SubmitProofResult> {
  // ── 1. The payment must exist for THIS subscription ────────────────
  const payment = await db.query.paymentsD17.findFirst({
    where: and(
      eq(paymentsD17.subscriptionId, input.subscriptionId),
      eq(paymentsD17.organizationId, input.organizationId),
    ),
  });
  if (!payment) {
    throw new D17ProofError('not_found', 'no_payment');
  }

  if (payment.status === 'paid') {
    throw new D17ProofError('conflict', 'already_paid');
  }
  if (payment.status === 'expired') {
    throw new D17ProofError('conflict', 'expired');
  }

  // ── 2. Payment window ──────────────────────────────────────────────
  if (payment.expiresAt.getTime() < Date.now()) {
    await db
      .update(paymentsD17)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(paymentsD17.id, payment.id));
    await appendAudit({
      actorType: 'user',
      actorId: null,
      organizationId: payment.organizationId,
      action: 'd17.expired',
      targetType: 'payment_d17',
      targetId: payment.id,
      after: { reason: 'window_elapsed' },
    });
    throw new D17ProofError('conflict', 'expired');
  }

  // ── 3. Authorization number ────────────────────────────────────────
  const authNumber = normalizeAuthNumber(input.authorizationNumber);
  if (!isValidAuthNumber(authNumber)) {
    throw new D17ProofError(
      'validation',
      `auth_format:${authNumberPattern().source}`,
    );
  }

  const senderPhone = normalizeSenderPhone(input.senderPhone);
  if (!senderPhone) {
    throw new D17ProofError('validation', 'phone_format');
  }

  // ── 4. Duplicate: one transfer pays one subscription ───────────────
  const clash = await db.query.paymentsD17.findFirst({
    where: and(
      eq(paymentsD17.authorizationNumber, authNumber),
      ne(paymentsD17.id, payment.id),
    ),
  });
  if (clash) {
    // The customer sees a friendly message; the admin sees the attempt.
    await appendAudit({
      actorType: 'user',
      actorId: null,
      organizationId: payment.organizationId,
      action: 'd17.duplicate_blocked',
      targetType: 'payment_d17',
      targetId: payment.id,
      after: {
        authorizationNumber: authNumber,
        conflictingPaymentId: clash.id,
        ip: input.ip,
      },
    });
    log.warn('d17: duplicate authorization number refused', {
      organizationId: payment.organizationId,
    });
    throw new D17ProofError('conflict', 'auth_duplicate');
  }

  // ── 5. Rate limit — 5 per hour, per IP and per subscription ─────────
  // A dedicated limiter rather than the login throttle: a mistyped
  // authorization number is not a credential attack, and the login
  // policy's 30-second penalty on a second attempt would lock out a
  // customer mid-transfer. See d17-ratelimit.ts.
  for (const bucket of [
    `d17-proof:ip:${input.ip ?? 'unknown'}`,
    `d17-proof:sub:${input.subscriptionId}`,
  ]) {
    const limit = await recordSubmission(bucket);
    if (!limit.allowed) {
      throw new D17ProofError('conflict', 'rate_limited');
    }
  }

  // ── 6. Screenshot (content-typed, EXIF-stripped, outside web root) ─
  let screenshotPath = payment.screenshotPath;
  if (input.screenshot && input.screenshot.size > 0) {
    screenshotPath = (await storeScreenshot(input.screenshot)) ?? screenshotPath;
  }

  // ── 7. Review flag ─────────────────────────────────────────────────
  const others = await recentProofsFromPhone(senderPhone, payment.id);
  const flaggedReview = others >= reviewFlagThreshold();

  // ── 8. Write ───────────────────────────────────────────────────────
  await db
    .update(paymentsD17)
    .set({
      authorizationNumber: authNumber,
      senderPhone,
      screenshotPath,
      status: 'proof_submitted',
      submittedAt: new Date(),
      flaggedReview,
      ip: input.ip,
      userAgent: input.userAgent,
      updatedAt: new Date(),
    })
    .where(eq(paymentsD17.id, payment.id));

  await appendAudit({
    actorType: 'user',
    actorId: null,
    organizationId: payment.organizationId,
    action: 'd17.proof_submitted',
    targetType: 'payment_d17',
    targetId: payment.id,
    after: {
      authorizationNumber: authNumber,
      senderPhone,
      flaggedReview,
      hasScreenshot: Boolean(screenshotPath),
    },
  });

  // ── Notifications: customer first, ops second ──────────────────────
  const [sub, org, ownerMembership] = await Promise.all([
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, input.subscriptionId),
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, payment.organizationId),
    }),
    db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, payment.organizationId),
        eq(organizationMembers.role, 'owner'),
      ),
    }),
  ]);
  const plan = sub
    ? await db.query.plans.findFirst({ where: eq(plans.id, sub.planId) })
    : null;

  if (org?.name && plan) {
    const templates = d17EmailTemplates(input.lang ?? 'fr');
    const vars = {
      plan: plan.name,
      amount: formatTndMillimes(payment.amountMillimes),
      auth: authNumber,
      hours: String(Math.max(1, Math.round(reviewWindowMinutes() / 60))),
    };

    // Customer confirmation. A failure here must NOT fail the
    // submission: the proof is recorded either way, and the customer is
    // looking at a waiting page that says so.
    if (ownerMembership) {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, ownerMembership.userId),
      });
      if (owner?.email) {
        try {
          await sendEmail({
            to: owner.email,
            subject: templates.receivedSubject(vars),
            text: templates.receivedBody(vars),
          });
        } catch (e) {
          log.error('d17: customer notification failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // Ops notification — D17 sends the merchant nothing, so this email
    // is the only signal that money may have arrived.
    const opsEmail = (process.env.OPS_ALERT_EMAIL ?? '').trim();
    if (opsEmail) {
      try {
        await sendEmail({
          to: opsEmail,
          subject: templates.adminSubject(vars),
          text: templates.adminBody({
            ...vars,
            org: org.name,
            phone: senderPhone,
            submittedAt: new Date().toISOString(),
          }),
        });
      } catch (e) {
        log.error('d17: ops notification failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  log.info('d17: proof submitted', {
    organizationId: payment.organizationId,
    paymentId: payment.id,
    flaggedReview,
  });

  return { paymentId: payment.id, flaggedReview };
}
