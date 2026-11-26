/**
 * Re-sync on a RETURNING sign-in — the rule that keeps the two identity
 * tables in step with the provider.
 *
 * This is the half that used to be missing: a user was written once at
 * signup and never reconciled again, so a GitHub account whose primary
 * address was private on day one stayed on an unverifiable `.invalid`
 * placeholder forever — unable to create a key, chat, or pay, with nothing
 * in the UI explaining why.
 *
 * The properties proven here, in order of how much they cost if wrong:
 *
 *   1. a chosen name is NEVER overwritten by the provider's
 *   2. verification only ever upgrades — never un-verifies
 *   3. the placeholder is replaced only by a real, verified, unowned address
 *   4. `sessionEmail` always matches what will be written, because the
 *      callback mints the session from it and `authorize.ts` resolves by
 *      exact match
 */
import { describe, it, expect } from 'vitest';
import {
  isPlaceholderEmail,
  planIdentitySync,
  type ProviderClaims,
  type StoredIdentity,
} from '@/lib/auth/oauth/policy';

const stored = (over: Partial<StoredIdentity> = {}): StoredIdentity => ({
  email: 'alice@example.com',
  name: 'Alice',
  authName: 'Alice',
  emailVerified: true,
  ...over,
});

const claims = (over: Partial<ProviderClaims> = {}): ProviderClaims => ({
  email: 'alice@example.com',
  name: 'Alice',
  emailVerified: true,
  ...over,
});

describe('name — filled only when ours is empty', () => {
  it('keeps the name the customer chose, even when the provider disagrees', () => {
    const p = planIdentitySync(stored({ name: 'Alice Chosen' }), claims({ name: 'alice1987' }), false);
    expect(p.name).toBeNull();
    expect(p.nameFilled).toBe(false);
    expect(p.changed).toBe(false);
  });

  it('keeps a name chosen on the domain mirror while the auth row is empty', () => {
    // The exact shape `updateProfile` produces: `users.name` set, and
    // `auth_users.name` never written. Filling blindly from the provider
    // would overwrite the chosen name on the very next sign-in.
    const p = planIdentitySync(
      stored({ name: 'Alice Chosen', authName: null }),
      claims({ name: 'alice1987' }),
      false,
    );
    expect(p.name).toBe('Alice Chosen');
    expect(p.nameFilled).toBe(true);
  });

  it('fills an empty name from the provider when neither row has one', () => {
    const p = planIdentitySync(
      stored({ name: null, authName: null }),
      claims({ name: 'Alice FromGoogle' }),
      false,
    );
    expect(p.name).toBe('Alice FromGoogle');
    expect(p.changed).toBe(true);
  });

  it('backfills the auth row from the domain row, not from the provider', () => {
    const p = planIdentitySync(
      stored({ name: 'Alice Chosen', authName: null }),
      claims({ name: 'provider-name' }),
      false,
    );
    expect(p.name).toBe('Alice Chosen');
  });

  it('treats a whitespace-only name as empty', () => {
    const p = planIdentitySync(
      stored({ name: '   ', authName: '   ' }),
      claims({ name: 'Real Name' }),
      false,
    );
    expect(p.name).toBe('Real Name');
  });

  it('does not write a blank name over an empty one', () => {
    const p = planIdentitySync(
      stored({ name: null, authName: null }),
      claims({ name: '   ' }),
      false,
    );
    expect(p.name).toBeNull();
    expect(p.nameFilled).toBe(false);
  });
});

describe('verification — upgrades only', () => {
  it('stamps an identity the provider has now verified', () => {
    const p = planIdentitySync(
      stored({ emailVerified: false }),
      claims({ emailVerified: true }),
      false,
    );
    expect(p.emailVerified).toBe(true);
    expect(p.changed).toBe(true);
  });

  it('never downgrades a verification we already hold', () => {
    // A provider that stops asserting verification (a scope was revoked,
    // say) must not un-verify an address confirmed by our own email link.
    const p = planIdentitySync(
      stored({ emailVerified: true }),
      claims({ emailVerified: false }),
      false,
    );
    expect(p.emailVerified).toBe(false);
    expect(p.changed).toBe(false);
  });
});

describe('email — the placeholder is the only thing ever rewritten', () => {
  const placeholder = 'no-email+github-99@users.invalid';

  it('promotes the placeholder to a real verified address nobody owns', () => {
    const p = planIdentitySync(
      stored({ email: placeholder, emailVerified: false }),
      claims({ email: 'alice@example.com', emailVerified: true }),
      false,
    );
    expect(p.email).toBe('alice@example.com');
    expect(p.emailVerified).toBe(true);
    expect(p.sessionEmail).toBe('alice@example.com');
    expect(p.changed).toBe(true);
  });

  it('does NOT promote onto an address another identity already owns', () => {
    // 0041's unique index would reject the UPDATE; more importantly the
    // address is not ours to take.
    const p = planIdentitySync(
      stored({ email: placeholder, emailVerified: false }),
      claims({ email: 'taken@example.com', emailVerified: true }),
      true,
    );
    expect(p.email).toBeNull();
    expect(p.sessionEmail).toBe(placeholder);
  });

  it('does NOT promote on an UNVERIFIED provider claim', () => {
    const p = planIdentitySync(
      stored({ email: placeholder, emailVerified: false }),
      claims({ email: 'alice@example.com', emailVerified: false }),
      false,
    );
    expect(p.email).toBeNull();
    expect(p.sessionEmail).toBe(placeholder);
  });

  it('never rewrites a REAL address, even when the provider reports another', () => {
    // The scenario: an account created by email, then linked to a provider
    // whose address differs (or is capitalised differently). The canonical
    // address must not move — memberships, keys and audit rows point at it.
    const p = planIdentitySync(
      stored({ email: 'alice@example.com' }),
      claims({ email: 'alice@other.com', emailVerified: true }),
      false,
    );
    expect(p.email).toBeNull();
    expect(p.sessionEmail).toBe('alice@example.com');
  });
});

describe('sessionEmail — what the callback mints with', () => {
  it('equals the stored address when nothing about the email changed', () => {
    const p = planIdentitySync(stored(), claims({ name: 'New' }), false);
    expect(p.sessionEmail).toBe('alice@example.com');
  });

  it('equals the stored address even for a placeholder identity', () => {
    // This is the case that used to mint a session with the provider's raw
    // email and then fail every request with 401.
    const placeholder = 'no-email+github-99@users.invalid';
    const p = planIdentitySync(
      stored({ email: placeholder }),
      claims({ email: null, emailVerified: false }),
      false,
    );
    expect(p.sessionEmail).toBe(placeholder);
  });
});

describe('isPlaceholderEmail', () => {
  it('recognises the reserved-TLD form', () => {
    expect(isPlaceholderEmail('no-email+apple-1@users.invalid')).toBe(true);
    expect(isPlaceholderEmail('NO-EMAIL+APPLE-1@USERS.INVALID')).toBe(true);
  });

  it('does not mistake a real address for one', () => {
    expect(isPlaceholderEmail('alice@example.com')).toBe(false);
    expect(isPlaceholderEmail('alice@users.example.com')).toBe(false);
  });
});
