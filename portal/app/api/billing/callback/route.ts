/**
 * POST /api/billing/callback — the provider's webhook.
 *
 * Three rules, in this order (PLATFORM.md §6.2):
 *
 *   1. Verify the signature over the RAW body, before any parsing.
 *      Parsing first throws away the bytes the signature covers.
 *   2. Dedupe on the provider's event id (`billing_events`), before any
 *      state change. A replayed callback is a 200 no-op.
 *   3. Fail with 500 when we cannot apply the event, so the provider
 *      retries — never a silent 200 on a half-applied transition.
 *
 * Unauthenticated by design: the signature IS the authentication.
 */

import { applyCallback, BillingError } from '@/lib/billing';
import { billingProvider } from '@/lib/billing/index';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let event;
  try {
    event = await billingProvider.verify(rawBody, {
      'x-billing-signature': request.headers.get('x-billing-signature'),
    });
  } catch (e) {
    log.warn('billing: callback signature rejected', {
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonError('validation', 'Invalid callback signature.');
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
        log.error('billing: callback could not be applied', { error: e.message });
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
