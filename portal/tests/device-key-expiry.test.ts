/**
 * Device key expiry — the 30-day TTL must actually be enforced.
 *
 * THE BUG. The device flow mints a key with `expires_at` 30 days out. The
 * column was SELECTed into `keyInfoFor` and returned to callers, but never
 * used as a predicate, so an expired key still answered:
 *
 *   GET /api/device/usage  -> 200
 *
 * The desktop therefore looked signed in, and the failure surfaced only when
 * a prompt reached LiteLLM and came back 401/403 — indistinguishable from a
 * revoked key, a wrong alias or a spent pool. The one message a metered
 * product must never fumble is "your key expired, sign in again".
 *
 * These are source-level assertions: the predicate is SQL, and the honest
 * way to test SQL without a live database is to pin the predicate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PORTAL = new URL('../', import.meta.url).pathname;
const src = readFileSync(`${PORTAL}lib/device/auth.ts`, 'utf8');

describe('keyInfoFor rejects expired keys', () => {
  it('has an expiry predicate in the query', () => {
    expect(src).toMatch(/expires_at\s*>\s*now\(\)/);
  });

  it('still allows a key with no expiry (org keys, pre-TTL keys)', () => {
    // NULL must pass: an org key and a key minted before device TTLs existed
    // both have no expiry, and rejecting them would sign out every existing
    // desktop user on deploy.
    expect(src).toMatch(/expires_at IS NULL OR ak\.expires_at > now\(\)/);
  });

  it('keeps revocation and org status as separate predicates', () => {
    // Expiry must not replace these — an expired key and a revoked key are
    // different states, and an org can be suspended independently.
    expect(src).toContain('revoked_at IS NULL');
    expect(src).toContain("o.status = 'active'");
  });

  it('is enforced in SQL, not a JS date comparison after the fetch', () => {
    // A JS comparison would run against the app server's clock, not the
    // database's, so the two could disagree about "now" — and the query
    // would still return a row the caller has to remember to reject.
    expect(src).not.toMatch(/if \(expiry\.getTime\(\) < Date\.now\(\)\)/);
  });
});
