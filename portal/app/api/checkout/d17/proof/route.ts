/**
 * POST /api/checkout/d17/proof — submit D17 payment proof.
 *
 * THE CUSTOMER-FACING END OF MANUAL PAYMENT. It existed only as a
 * `'use server'` form action until the frontend was rebuilt; deleting that
 * action removed the ONLY way a customer could hand over an authorization
 * number, which left `lib/billing/d17-proof.ts` (360 lines, proven by
 * `make verify-d17`) unreachable from a browser.
 *
 * Authorization is the same rule as every other route: the org comes from
 * the session, never the body, and the subscription must belong to it. A
 * subscription id belonging to another account answers 404 — a customer
 * must not learn that someone else's payment exists, let alone file a
 * proof against it.
 *
 * The amount is NEVER read from the request. There is no amount field to
 * send; `submitD17Proof` loads it from the row the checkout created. That
 * is what makes tamper-resistance structural rather than validated.
 *
 * Errors are localised: the form sends `lang`, and each failure is
 * translated to the message the customer is meant to read rather than the
 * internal code (`auth_duplicate`, `rate_limited`, `expired`, …).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { submitD17Proof, D17ProofError } from '@/lib/billing/d17-proof';
import { isD17Lang, t17 } from '@/lib/i18n/d17';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Internal reason → the i18n key the customer sees. */
const REASON_KEY: Record<string, string> = {
  auth_format: 'd17.err_auth_format',
  phone_format: 'd17.err_phone',
  auth_duplicate: 'd17.err_auth_duplicate',
  rate_limited: 'd17.err_ratelimited',
  expired: 'd17.err_expired',
  already_paid: 'd17.err_expired',
  screenshot_too_large: 'd17.err_screenshot',
  screenshot_type: 'd17.err_screenshot',
  screenshot_unreadable: 'd17.err_screenshot',
};

/**
 * `D17ProofError.code` → the envelope code, so the response speaks the
 * same vocabulary as every other route (`errorResponse` has no branch for
 * D17ProofError because these messages are already customer-ready).
 *
 *   validation → 400   the number, the phone, or the screenshot is wrong
 *   conflict   → 409   duplicate, expired, rate-limited, already paid
 *   not_found  → 404   no payment row for this subscription
 *   upstream/internal → 500, message replaced by the envelope
 */
const PROOF_ERROR_CODE = {
  validation: 'validation',
  conflict: 'conflict',
  not_found: 'not_found',
  upstream: 'internal',
  internal: 'internal',
} as const;

/**
 * The client IP.
 *
 * Caddy deletes inbound `X-Forwarded-For` (see config/Caddyfile — a
 * forged one must not survive to the application), so there is no trusted
 * forwarded header to read here and this is normally null. It is still
 * read when present, because a deployment behind a trusted proxy sets it,
 * and it only ever widens the rate-limit buckets — it is never used as
 * identity or for a permission decision.
 */
function clientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('validation', t17('en', 'd17.err_generic'));
  }

  const subscriptionId = String(form.get('subscriptionId') ?? '');
  const authorizationNumber = String(form.get('authorizationNumber') ?? '');
  const senderPhone = String(form.get('senderPhone') ?? '');
  const confirmed = form.get('confirm') === 'on' || form.get('confirm') === 'true';
  const langRaw = String(form.get('lang') ?? '');
  const lang = isD17Lang(langRaw) ? langRaw : 'fr';

  if (!confirmed) {
    return jsonError('validation', t17(lang, 'd17.err_confirm'));
  }
  if (!subscriptionId || !authorizationNumber || !senderPhone) {
    return jsonError('validation', t17(lang, 'd17.err_generic'));
  }

  try {
    const ctx = await requireActiveOrg();

    const sub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.organizationId, ctx.orgId),
      ),
    });
    if (!sub) {
      return jsonError('not_found', t17(lang, 'd17.err_generic'));
    }

    const raw = form.get('screenshot');
    const screenshot =
      raw instanceof File && raw.size > 0 ? raw : null;

    const result = await submitD17Proof({
      subscriptionId,
      organizationId: ctx.orgId,
      authorizationNumber,
      senderPhone,
      screenshot,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      lang,
    });

    return Response.json({ ok: true, flaggedReview: result.flaggedReview });
  } catch (e) {
    if (e instanceof D17ProofError) {
      // The reason is the first segment: `auth_format:<pattern>` carries
      // the configured regex for the log, and must not reach the customer.
      const [reason] = e.message.split(':');
      const key = REASON_KEY[reason ?? ''] ?? 'd17.err_generic';
      return jsonError(PROOF_ERROR_CODE[e.code], t17(lang, key));
    }
    return errorResponse(e);
  }
}