/**
 * API error envelope — IMPLEMENTATION.md §3.
 *
 * Contract: every JSON route returns either its data or
 * `{ error: { code, message } }` with `code` drawn from a fixed set.
 * Never a stack trace, a key, or a Stripe object.
 *
 * `internal` and `upstream` messages are REPLACED, not forwarded. An
 * upstream failure's real message ("LiteLLM /key/generate → 500" with a
 * response body) is useful in the log and useless — and mildly
 * revealing — to a caller who is, at that moment, someone probing our
 * endpoints. Detail goes to stderr via log.error; the client gets a
 * sentence it can act on.
 */

import { AuthzError } from '@/lib/auth/errors';
import { BillingError } from '@/lib/billing';
import { KeyServiceError } from '@/lib/keys/types';
import { log } from '@/lib/log';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'upstream'
  | 'internal'
  | 'payment_required';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  upstream: 502,
  internal: 500,
  payment_required: 402,
};

const GENERIC: Partial<Record<ApiErrorCode, string>> = {
  upstream: 'The gateway could not complete the request. Try again in a moment.',
  internal: 'Something went wrong. Please try again.',
};

export function jsonError(code: ApiErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message: GENERIC[code] ?? message } },
    { status: STATUS[code] },
  );
}

/**
 * Map a thrown error to a response.
 *
 * AuthzError and KeyServiceError carry the customer's own words (which
 * model is not in their plan, that they are at the key ceiling) and are
 * safe to forward. Everything else is unexpected: log it, answer 500.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof AuthzError) {
    return jsonError(error.code, error.message);
  }
  if (error instanceof KeyServiceError) {
    return jsonError(error.code, error.message);
  }
  if (error instanceof BillingError) {
    return jsonError(error.code, error.message);
  }

  log.error('unhandled api error', {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  return jsonError('internal', 'Something went wrong. Please try again.');
}
