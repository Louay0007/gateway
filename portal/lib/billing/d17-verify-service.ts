/**
 * D17 automatic verification — the service half.
 *
 * WHAT THIS IS NOT. It does not call a model, and it does not decide what a
 * screenshot says. A reading arrives from outside (today: an n8n workflow
 * driving Zaino's own `/v1/messages`), and this module holds the two rules
 * that make accepting such a reading safe:
 *
 *   1. THE READING IS RECORDED BEFORE ANYTHING HAPPENS. Every attempt lands
 *      in `payments_d17_verifications`, pass or fail, including the ones that
 *      are refused. A refused reading that left no trace would make "why was
 *      this approved?" unanswerable, which is the only question that matters
 *      when a chargeback arrives.
 *
 *   2. THE DECISION IS RECOMPUTED HERE, NOT TRUSTED FROM THE CALLER.
 *      `scoreVerification()` is pure and lives in d17-verify.ts. A workflow
 *      that sends `{"verdict":"pass"}` alongside fields that clearly do not
 *      match gets the verdict the fields earn. That matters because the
 *      caller holds a service token that also permits approving, so a bug
 *      upstream must not be able to become a wrong payment by assertion.
 */

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  organizations,
  paymentsD17,
  paymentsD17Verifications,
  plans,
  subscriptions,
} from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { log } from '@/lib/log';
import { d17ReceiverPhone, formatTndMillimes } from './d17-config';
import {
  type ExtractedProof,
  type VerificationDecision,
  PROMPT_VERSION,
  VERIFY_MODEL,
  scoreVerification,
} from './d17-verify';
import { approveD17Payment } from './d17-admin';

/** The actor id written to payments.verified_by when the agent approves. */
export const AGENT_ACTOR_ID = 'agent:d17-verify';

export interface VerifyInput {
  paymentId: string;
  extracted: ExtractedProof;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface VerifyOutcome {
  ok: boolean;
  error?: 'not_found' | 'not_submitted' | 'no_screenshot';
  decision?: VerificationDecision;
  approved?: boolean;
  blockedBy?: string | null;
}

/**
 * Score a reading, record it, and approve only when both the verdict and the
 * operator's policy allow it.
 */
export async function verifyD17Proof(input: VerifyInput): Promise<VerifyOutcome> {
  const payment = await db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.id, input.paymentId),
  });
  if (!payment) return { ok: false, error: 'not_found' };
  if (payment.status !== 'proof_submitted') return { ok: false, error: 'not_submitted' };
  if (!payment.screenshotPath) return { ok: false, error: 'no_screenshot' };

  const decision = scoreVerification(input.extracted, {
    amountMillimes: payment.amountMillimes,
    authNumber: payment.authorizationNumber ?? '',
    senderPhone: payment.senderPhone,
    receiverPhone: d17ReceiverPhone(),
    submittedAt: payment.submittedAt ?? new Date(),
    flaggedReview: payment.flaggedReview,
  });

  // Auto-approval is a policy, not a default. A deployment that has not
  // opted in gets the queue this route replaced, with a verdict attached.
  const autoApprove = (process.env.D17_VERIFY_AUTO_APPROVE ?? 'false') === 'true';
  const willApprove = decision.verdict === 'pass' && autoApprove && !payment.flaggedReview;
  const blockedBy = decision.verdict === 'pass' && !willApprove
    ? (autoApprove ? 'flagged_review' : 'auto_approve_disabled')
    : decision.blockedBy;

  // Record first. If approval throws, the evidence of the decision still
  // exists and staff can see what the agent concluded.
  const [row] = await db
    .insert(paymentsD17Verifications)
    .values({
      paymentId: payment.id,
      model: input.model ?? VERIFY_MODEL,
      promptVersion: PROMPT_VERSION,
      extractedAmount: input.extracted.amount,
      extractedAuthNumber: input.extracted.authNumber,
      extractedPhone: input.extracted.senderPhone,
      extractedReceiver: input.extracted.receiverPhone,
      extractedDate: input.extracted.date,
      checks: decision.checks,
      score: decision.score,
      verdict: decision.verdict,
      reason: decision.reason,
      approved: false,
      blockedBy,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    })
    .returning({ id: paymentsD17Verifications.id });

  // An INSERT ... RETURNING always yields one row; the undefined arm exists
  // only because drizzle's tuple type does not say so.
  if (!row) throw new Error('d17: verification insert returned no row');

  let approved = false;
  if (willApprove) {
    const result = await approveD17Payment(AGENT_ACTOR_ID, payment.id);
    approved = result.ok;
    if (!result.ok) {
      log.error('d17: auto-approval failed after a passing read', {
        paymentId: payment.id,
        error: result.error,
      });
    }
    // The payment may have flipped to paid; the evidence row must say so,
    // and must not claim it when activation failed.
    await db
      .update(paymentsD17Verifications)
      .set({ approved, blockedBy: approved ? null : (result.error ?? 'approval_failed') })
      .where(eq(paymentsD17Verifications.id, row.id));
  }

  await appendAudit({
    actorType: 'system',
    actorId: AGENT_ACTOR_ID,
    organizationId: payment.organizationId,
    action: approved ? 'd17.auto_approved' : 'd17.verified',
    targetType: 'payment_d17',
    targetId: payment.id,
    after: {
      verdict: decision.verdict,
      score: decision.score,
      checks: decision.checks,
      blockedBy: approved ? null : blockedBy,
    },
  });

  log.info('d17: proof verified', {
    paymentId: payment.id,
    verdict: decision.verdict,
    score: decision.score,
    approved,
  });

  return { ok: true, decision, approved, blockedBy: approved ? null : blockedBy };
}

export interface VerificationRow {
  id: string;
  paymentId: string;
  organizationName: string;
  planCode: string;
  amount: string;
  amountMillimes: number;
  authorizationNumber: string;
  senderPhone: string | null;
  hasScreenshot: boolean;
  submittedAt: string | null;
  expiresAt: string;
  flaggedReview: boolean;

  /** Latest reading, or null when nobody has looked yet. */
  model: string | null;
  score: number | null;
  verdict: 'pass' | 'review' | 'fail' | null;
  reason: string | null;
  checks: Record<string, string> | null;
  extractedAmount: string | null;
  extractedAuthNumber: string | null;
  approved: boolean;
  blockedBy: string | null;
  verifiedAt: string | null;

  /** Hours since submission. What the queue-aging signal is built on. */
  ageHours: number;
}

/**
 * The queue, with the latest reading attached.
 *
 * `statuses` defaults to what is waiting. The route passes `proof_submitted`
 * for the agent's worklist and the admin page may pass more for a shift view.
 *
 * Sorted NEWEST FIRST, which is the opposite of what a queue-aging alarm
 * wants — the alarm reads `ageHours` off these rows rather than relying on
 * order, so one query serves both. Sorting oldest-first would put a month-old
 * stuck row above a fresh one for staff triaging by hand.
 */
export async function listVerificationQueue(
  statuses: string[] = ['proof_submitted'],
  limit = 200,
): Promise<VerificationRow[]> {
  const payments = await db
    .select({
      paymentId: paymentsD17.id,
      organizationName: organizations.name,
      planCode: plans.code,
      amountMillimes: paymentsD17.amountMillimes,
      authorizationNumber: paymentsD17.authorizationNumber,
      senderPhone: paymentsD17.senderPhone,
      screenshotPath: paymentsD17.screenshotPath,
      submittedAt: paymentsD17.submittedAt,
      expiresAt: paymentsD17.expiresAt,
      flaggedReview: paymentsD17.flaggedReview,
    })
    .from(paymentsD17)
    .innerJoin(organizations, eq(organizations.id, paymentsD17.organizationId))
    .innerJoin(subscriptions, eq(subscriptions.id, paymentsD17.subscriptionId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(sql`${paymentsD17.status} IN ${statuses}`)
    .orderBy(desc(paymentsD17.submittedAt))
    .limit(limit);

  if (payments.length === 0) return [];

  // Latest reading per payment, two statements rather than a lateral join
  // (this drizzle version has none). DISTINCT ON takes the newest row per
  // payment in one pass; joining on max(created_at) would fan out on an
  // attempt that shares a timestamp.
  const ids = payments.map((p) => p.paymentId);
  const latest = await db
    .select({
      paymentId: paymentsD17Verifications.paymentId,
      id: paymentsD17Verifications.id,
      model: paymentsD17Verifications.model,
      score: paymentsD17Verifications.score,
      verdict: paymentsD17Verifications.verdict,
      reason: paymentsD17Verifications.reason,
      checks: paymentsD17Verifications.checks,
      amount: paymentsD17Verifications.extractedAmount,
      authNumber: paymentsD17Verifications.extractedAuthNumber,
      approved: paymentsD17Verifications.approved,
      blockedBy: paymentsD17Verifications.blockedBy,
      createdAt: paymentsD17Verifications.createdAt,
    })
    .from(paymentsD17Verifications)
    .where(inArray(paymentsD17Verifications.paymentId, ids))
    .orderBy(paymentsD17Verifications.paymentId, desc(paymentsD17Verifications.createdAt));

  const byPayment = new Map<string, (typeof latest)[number]>();
  for (const v of latest) {
    if (!byPayment.has(v.paymentId)) byPayment.set(v.paymentId, v); // newest first
  }

  const now = Date.now();
  return payments.map((p) => {
    const v = byPayment.get(p.paymentId);
    const submitted = p.submittedAt;
    return {
      id: v?.id ?? p.paymentId,
      paymentId: p.paymentId,
      organizationName: p.organizationName,
      planCode: p.planCode,
      amount: formatTndMillimes(p.amountMillimes),
      amountMillimes: p.amountMillimes,
      authorizationNumber: p.authorizationNumber ?? '',
      senderPhone: p.senderPhone,
      hasScreenshot: Boolean(p.screenshotPath),
      submittedAt: submitted?.toISOString() ?? null,
      expiresAt: p.expiresAt.toISOString(),
      flaggedReview: p.flaggedReview,
      model: v?.model ?? null,
      score: v?.score ?? null,
      verdict: v?.verdict ?? null,
      reason: v?.reason ?? null,
      checks: (v?.checks as Record<string, string> | null) ?? null,
      extractedAmount: v?.amount ?? null,
      extractedAuthNumber: v?.authNumber ?? null,
      approved: v?.approved ?? false,
      blockedBy: v?.blockedBy ?? null,
      verifiedAt: v?.createdAt.toISOString() ?? null,
      ageHours: submitted
        ? Math.round(((now - submitted.getTime()) / 3_600_000) * 10) / 10
        : 0,
    };
  });
}

/**
 * A pending proof older than this is worth a human's attention now.
 * Read by the aging endpoint and the n8n reminder flow.
 */
export function queueAgeWarnHours(): number {
  const raw = Number(process.env.D17_QUEUE_WARN_HOURS ?? '4');
  if (!Number.isFinite(raw) || raw <= 0) return 4;
  return raw;
}

/** Payments waiting longer than the warn threshold, oldest first. */
export async function agedProofs(): Promise<VerificationRow[]> {
  const rows = await listVerificationQueue(['proof_submitted']);
  const warn = queueAgeWarnHours();
  return rows.filter((r) => r.ageHours >= warn).sort((a, b) => b.ageHours - a.ageHours);
}

/**
 * The screenshot read by the agent, base64-encoded.
 *
 * The existing `/api/admin/d17/[id]/screenshot` route streams bytes for a
 * browser. A model needs the same bytes inside a JSON body, and reaching
 * through a session-gated route with a service token would be worse than
 * reading the file the same way that route does — same path validation, same
 * directory, one fewer hop. Returns null when the row names a file that is
 * not on disk, which the caller must treat as `no_screenshot`.
 */
export async function readProofScreenshot(paymentId: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  const { d17UploadsDir } = await import('./d17-config');

  const payment = await db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.id, paymentId),
    columns: { screenshotPath: true },
  });
  if (!payment?.screenshotPath) return null;

  const name = payment.screenshotPath;
  // The name is ours (a UUID), but a value from a database column that
  // reaches a filesystem is a traversal primitive until proven otherwise.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) return null;

  try {
    const bytes = await readFile(`${d17UploadsDir()}/${name}`);
    return bytes.toString('base64');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw e;
  }
}

/** Kept for the route's 404 path: a fabricated id must not 500. */
export async function paymentExists(paymentId: string): Promise<boolean> {
  const row = await db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.id, paymentId),
    columns: { id: true },
  });
  return Boolean(row);
}
