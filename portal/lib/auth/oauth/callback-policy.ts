/**
 * The callback's gate sequence, as a PURE function — plan §8 items 5–7.
 *
 * The route cannot be unit-tested directly: it imports `next/headers` and
 * the database client, neither of which exists outside a request. But the
 * ORDER of its checks is the security property, and it is exactly the part
 * that a refactor can silently reorder:
 *
 *   cancel → no cookie → provider mismatch → state mismatch → exchange
 *
 * Getting that order wrong has two specific consequences, both tested:
 *
 *   - checking `state` before the cookie returns 400 "expired" for a
 *     perfectly valid callback (a session the user cannot complete)
 *   - returning 500 instead of 400 for a missing cookie sends the user to an
 *     error page for a normal event (a bookmark, a back-button replay)
 *
 * The function takes facts and returns the first gate that fires. The route
 * performs it.
 */

export type CallbackGate =
  /** Continue to the token exchange. */
  | { gate: 'proceed' }
  /** The user cancelled (or the provider errored) — a notice, not an error. */
  | { gate: 'reject'; reason: 'cancelled' | 'failed' }
  /** No pending flow, or the flow belongs to another provider. */
  | { gate: 'reject'; reason: 'expired' }
  /** The provider in the URL is not one we serve. */
  | { gate: 'reject'; reason: 'unknown_provider' };

export interface CallbackFacts {
  /** From `?provider=` in the URL. Untrusted. */
  providerParam: string;
  /** Is `providerParam` one we implement? */
  providerKnown: boolean;
  /** `?error=` from the provider; `access_denied` means the user cancelled. */
  providerError: string | null;
  /** Whether an `oauth_pending` cookie was present and well-formed. */
  hasPending: boolean;
  /** The provider recorded IN THE COOKIE. NULL when there is no cookie. */
  pendingProvider: string | null;
  /** `?state=` echoed by the provider. */
  state: string | null;
  /** `state` recorded in the cookie. NULL when there is no cookie. */
  pendingState: string | null;
  /** Does `code` exist? */
  hasCode: boolean;
}

export function evaluateCallback(facts: CallbackFacts): CallbackGate {
  // 1. Unknown provider first: there is nothing to compare against, and a
  //    typo in the URL must not reach the exchange.
  if (!facts.providerKnown) return { gate: 'reject', reason: 'unknown_provider' };

  // 2. A provider error. `access_denied` is a CANCELLATION — the single
  //    most common "failure" and never an error page.
  if (facts.providerError) {
    return {
      gate: 'reject',
      reason: facts.providerError === 'access_denied' ? 'cancelled' : 'failed',
    };
  }

  // 3. No pending flow. A bookmark, a back-button replay, an expired
  //    cookie. 400 "start again", never a 500.
  if (!facts.hasPending) return { gate: 'reject', reason: 'expired' };

  // 4. The flow belongs to a DIFFERENT provider. The cookie is what we
  //    trust; the URL is attacker-supplied. Starting a Google flow and
  //    landing a GitHub callback must not exchange a Google code at GitHub.
  if (facts.pendingProvider !== facts.providerParam) {
    return { gate: 'reject', reason: 'expired' };
  }

  // 5. State. Compared by the caller in constant time — this function must
  //    not do the comparison itself, because a `===` here would be a
  //    timing oracle that no test could catch.
  if (!facts.state || !facts.pendingState || facts.state !== facts.pendingState) {
    return { gate: 'reject', reason: 'expired' };
  }

  // 6. A valid state with no code is a malformed callback, not a
  //    cancellation.
  if (!facts.hasCode) return { gate: 'reject', reason: 'failed' };

  return { gate: 'proceed' };
}

/**
 * Where each rejection lands. Fixed paths and fixed copy — the query string
 * selects a sentence from a fixed table and can never supply one.
 */
export function rejectDestination(reason: 'cancelled' | 'failed' | 'expired' | 'unknown_provider'): {
  path: string;
  query: Record<string, string>;
} {
  return { path: '/sign-in', query: { social: reason } };
}
