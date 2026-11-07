/**
 * POST /api/billing/callback — the provider's webhook.
 *
 * Three rules, in this order:
 *
 *   1. Verify the signature over the RAW body, before any parsing.
 *      Parsing first throws away the bytes the signature covers.
 *   2. Dedupe on the provider's event id (`billing_events`), before any
 *      state change. A replayed callback is a 200 no-op.
 *   3. Fail with 500 when we cannot apply the event, so the provider
 *      retries — never a silent 200 on a half-applied transition.
 *
 * Unauthenticated by design: the signature IS the authentication.
 *
 * WHICH PROVIDER. Two rails can deliver here, and the configured default
 * is not necessarily the one that sent a given callback — D17 keeps
 * arriving after Dodo goes live, and vice versa. Standard Webhooks'
 * `webhook-id` header is the discriminator: Dodo always sends it, the
 * dev provider never does. Getting this wrong means every Dodo webhook
 * is verified against the dev HMAC and rejected with a 400, so the
 * customer pays and stays on `incomplete`.
 */

import { applyCallback, BillingError } from '@/lib/billing';
import { billingProvider, resolveBillingProvider } from '@/lib/billing/index';
import { DODO_WEBHOOK_HEADERS } from '@/lib/billing/dodo';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Keep every header either rail might verify, so no provider needs a
 *  second parse of the request to read one it forgot about. */
function signatureHeaders(headers: Headers): Record<string, string | null> {
  return {
    'x-billing-signature': headers.get('x-billing-signature'),
    [DODO_WEBHOOK_HEADERS.id]: headers.get(DODO_WEBHOOK_HEADERS.id),
    [DODO_WEBHOOK_HEADERS.timestamp]: headers.get(DODO_WEBHOOK_HEADERS.timestamp),
    [DODO_WEBHOOK_HEADERS.signature]: headers.get(DODO_WEBHOOK_HEADERS.signature),
  };
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const headers = signatureHeaders(request.headers);

  const provider = headers[DODO_WEBHOOK_HEADERS.id]
    ? resolveBillingProvider('dodo')
    : billingProvider;

  let event;
  try {
    event = await provider.verify(rawBody, headers);
  } catch (e) {
    log.warn('billing: callback signature rejected', {
      provider: provider.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonError('validation', 'Invalid callback signature.');
  }

  // Verified, but a kind we deliberately do not act on (most of what a
  // merchant of record sends). 200 stops the retries; nothing is recorded.
  if (!event) {
    return Response.json({ ok: true, ignored: true });
  }

  try {
    const result = await applyCallback(event);
    return Response.json({
      ok: true,
      applied: result.applied,
      duplicate: result.duplicate,
      state: result.state,
    });
  } catch (e) {
    if (e instanceof BillingError) {
      // A 4xx here tells the provider "stop retrying", which is right
      // for a permanently unmappable event and wrong for a transient
      // sync failure — upstream failures must stay retryable.
      if (e.code === 'upstream') {
        log.error('billing: callback could not be applied', { error: (e as Error).message });
        return jsonError('internal', 'Payment could not be applied. It will be retried.');
      }
      return errorResponse(e);
    }
    log.error('billing: callback failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonError('internal', 'Payment could not be applied. It will be retried.');
  }
}
