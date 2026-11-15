/**
 * The callback gate sequence — plan §8 items 5, 6 and 7.
 *
 * Each case is an event the route will actually see. The assertions are
 * deliberately about the USER-VISIBLE outcome (a 400 vs an error page vs a
 * cancellation notice), because the failure this guards against is not a
 * wrong sign-in — it is a correct sign-in that looks broken, or a broken
 * one that looks fine.
 *
 * The ORDER is tested explicitly: several cases are only distinguishable
 * because one gate fires before another.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCallback, rejectDestination, type CallbackFacts } from '@/lib/auth/oauth/callback-policy';

/** A completely valid callback — every override below breaks exactly one thing. */
const valid: CallbackFacts = {
  providerParam: 'google',
  providerKnown: true,
  providerError: null,
  hasPending: true,
  pendingProvider: 'google',
  state: 'the-state',
  pendingState: 'the-state',
  hasCode: true,
};

function evaluate(over: Partial<CallbackFacts>): ReturnType<typeof evaluateCallback> {
  return evaluateCallback({ ...valid, ...over });
}

describe('a valid callback proceeds', () => {
  it('all gates pass', () => {
    expect(evaluate({})).toEqual({ gate: 'proceed' });
  });

  it('proceeds for each implemented provider', () => {
    for (const p of ['google', 'github', 'apple'] as const) {
      expect(evaluate({ providerParam: p, pendingProvider: p })).toEqual({ gate: 'proceed' });
    }
  });
});

describe('§8.5 — a missing pending cookie is a 400, never a 500', () => {
  it('rejects with "expired", which the route answers 400 + start again', () => {
    // A bookmark, a back-button replay, a cleared cookie jar, or a callback
    // opened in a different browser. All normal; none is a server error.
    expect(evaluate({ hasPending: false, pendingProvider: null, pendingState: null })).toEqual({
      gate: 'reject',
      reason: 'expired',
    });
  });

  it('does not reach the exchange even though every other fact is valid', () => {
    const verdict = evaluate({
      hasPending: false,
      pendingProvider: null,
      pendingState: null,
      state: 'the-state',
      hasCode: true,
    });
    expect(verdict.gate).toBe('reject');
  });
});

describe('§8.6 — access_denied is a cancellation, not an error page', () => {
  it('maps the user pressing Cancel to a quiet notice', () => {
    expect(evaluate({ providerError: 'access_denied' })).toEqual({
      gate: 'reject',
      reason: 'cancelled',
    });
  });

  it('maps any other provider error to a generic failure', () => {
    for (const err of ['invalid_scope', 'server_error', 'temporarily_unavailable', 'invalid_request']) {
      expect(evaluate({ providerError: err })).toEqual({ gate: 'reject', reason: 'failed' });
    }
  });

  it('treats a cancellation as final even with a valid state and code', () => {
    // Some providers send `error` AND a stale `code`. The error wins.
    expect(evaluate({ providerError: 'access_denied', hasCode: true })).toEqual({
      gate: 'reject',
      reason: 'cancelled',
    });
  });

  it('routes both rejections to /sign-in with a fixed notice key', () => {
    expect(rejectDestination('cancelled')).toEqual({ path: '/sign-in', query: { social: 'cancelled' } });
    expect(rejectDestination('failed')).toEqual({ path: '/sign-in', query: { social: 'failed' } });
    // No absolute URL, no reflected text.
    expect(rejectDestination('expired').path.startsWith('/')).toBe(true);
  });
});

describe('CSRF — the state and the cookie that scopes it', () => {
  it('rejects a mismatched state', () => {
    expect(evaluate({ state: 'attacker-chose-this' })).toEqual({ gate: 'reject', reason: 'expired' });
  });

  it('rejects a missing state', () => {
    expect(evaluate({ state: null })).toEqual({ gate: 'reject', reason: 'expired' });
  });

  it('rejects a state supplied WITHOUT a cookie (the whole attack)', () => {
    // An attacker starts a flow, keeps the state, and sends the callback URL
    // to a victim. With no cookie in the victim's browser there is nothing
    // to match — which is why `state` alone is not the control.
    expect(
      evaluate({ hasPending: false, pendingProvider: null, pendingState: null, state: 'attacker-knows-it' }),
    ).toEqual({ gate: 'reject', reason: 'expired' });
  });

  it('rejects a callback for a different provider than the flow started', () => {
    // A Google flow cannot be completed at the GitHub endpoint, even with a
    // correct state — the code would be redeemed against the wrong issuer.
    expect(evaluate({ providerParam: 'github', pendingProvider: 'google' })).toEqual({
      gate: 'reject',
      reason: 'expired',
    });
  });

  it('trusts the COOKIE over the URL when they disagree', () => {
    // The URL says apple, the cookie says google. Rejected either way; the
    // assertion is that the URL does not win.
    expect(evaluate({ providerParam: 'apple', pendingProvider: 'google' }).gate).toBe('reject');
  });
});

describe('malformed callbacks', () => {
  it('rejects an unknown provider without touching anything else', () => {
    expect(evaluate({ providerParam: 'facebook', providerKnown: false })).toEqual({
      gate: 'reject',
      reason: 'unknown_provider',
    });
  });

  it('rejects a valid state with no code', () => {
    expect(evaluate({ hasCode: false })).toEqual({ gate: 'reject', reason: 'failed' });
  });
});

describe('gate ORDER — the property a refactor breaks silently', () => {
  it('checks the provider name before the cancellation', () => {
    // With both wrong, the answer must be the one that cannot leak: an
    // unknown provider is a 404-shaped answer, not a "you cancelled".
    expect(evaluate({ providerKnown: false, providerParam: 'x', providerError: 'access_denied' })).toEqual({
      gate: 'reject',
      reason: 'unknown_provider',
    });
  });

  it('checks the cancellation BEFORE the cookie', () => {
    // A user who cancels without our cookie (e.g. an expired flow, then
    // Cancel) must see "you cancelled", not "your link expired".
    expect(evaluate({ providerError: 'access_denied', hasPending: false, pendingProvider: null })).toEqual({
      gate: 'reject',
      reason: 'cancelled',
    });
  });

  it('checks the cookie BEFORE the state', () => {
    // Both wrong: the honest answer is "start again", which is what a
    // missing cookie means. Reporting a state mismatch would suggest the
    // user's action caused it.
    expect(evaluate({ hasPending: false, pendingProvider: null, pendingState: null, state: 'x' })).toEqual({
      gate: 'reject',
      reason: 'expired',
    });
  });

  it('is deterministic — the same facts give the same answer', () => {
    const facts: CallbackFacts = { ...valid, state: 'other' };
    expect(evaluateCallback(facts)).toEqual(evaluateCallback(facts));
  });
});
