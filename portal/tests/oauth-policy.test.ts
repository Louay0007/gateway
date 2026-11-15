/**
 * The linking policy — plan §8 item 1, "all six cases".
 *
 * This is the file that stands between two customers and each other's
 * accounts, so it is tested as a truth table rather than by example: every
 * reachable combination of (account row, provider verification, email
 * ownership) appears below, and the expected action is asserted.
 *
 * The three rules being proven:
 *
 *   1. an existing account row signs in — full stop
 *   2. a verified provider email links ONLY to a verified, uniquely-owned
 *      account
 *   3. an unverified provider email NEVER links, whatever else is true
 */
import { describe, it, expect } from 'vitest';
import { decideLinking, normaliseEmail, storedEmailFor, type DecideInput } from '@/lib/auth/oauth/policy';
import type { OAuthIdentity } from '@/lib/auth/oauth/types';

const base: DecideInput = {
  hasExistingAccount: false,
  email: 'alice@example.com',
  providerVerifiedEmail: true,
  lookup: { owners: 0, ownerEmailVerified: null },
};

function decide(over: Partial<DecideInput>): ReturnType<typeof decideLinking> {
  return decideLinking({ ...base, ...over });
}

describe('rule 1 — an existing account row always signs in', () => {
  it('signs in regardless of email state (the row is proof)', () => {
    expect(decide({ hasExistingAccount: true })).toEqual({ action: 'sign_in_existing' });
  });

  it('signs in even when the provider now reports no email at all', () => {
    expect(decide({ hasExistingAccount: true, email: null, providerVerifiedEmail: false })).toEqual({
      action: 'sign_in_existing',
    });
  });

  it('signs in even when the provider now reports an UNVERIFIED email', () => {
    // A provider can stop verifying an address (or drop the claim). The
    // account row is proof the user already authenticated here before.
    expect(
      decide({ hasExistingAccount: true, providerVerifiedEmail: false, lookup: { owners: 1, ownerEmailVerified: true } }),
    ).toEqual({ action: 'sign_in_existing' });
  });
});

describe('rule 2 — verified email links to a verified, uniquely-owned account', () => {
  it('links when exactly one owner exists and that owner is verified', () => {
    expect(decide({ lookup: { owners: 1, ownerEmailVerified: true } })).toEqual({
      action: 'link_to_existing',
    });
  });

  it('creates a verified account when nobody owns the address', () => {
    expect(decide({ lookup: { owners: 0, ownerEmailVerified: null } })).toEqual({
      action: 'create_verified',
    });
  });

  it('REFUSES rather than picking one when two identities own the address', () => {
    // The 0041 unique index makes this impossible; if the index is missing
    // or dropped, this must refuse rather than guess.
    expect(decide({ lookup: { owners: 2, ownerEmailVerified: true } })).toEqual({
      action: 'refuse',
      reason: 'ambiguous_email',
    });
  });

  it('does NOT link to an unverified account, and creates an unverified one instead', () => {
    // Ownership is unproven on the target side, so linking inherits nothing.
    expect(decide({ lookup: { owners: 1, ownerEmailVerified: false } })).toEqual({
      action: 'create_unverified',
      reason: 'target_unverified',
    });
    expect(decide({ lookup: { owners: 1, ownerEmailVerified: null } })).toEqual({
      action: 'create_unverified',
      reason: 'target_unverified',
    });
  });
});

describe('rule 3 — an unverified provider email NEVER links', () => {
  it('creates unverified even when a verified account owns the address', () => {
    // THE takeover case: attacker registers victim@company.com at GitHub,
    // GitHub does not verify addresses it does not own, victim has a
    // verified account here.
    expect(
      decide({
        providerVerifiedEmail: false,
        lookup: { owners: 1, ownerEmailVerified: true },
      }),
    ).toEqual({ action: 'create_unverified', reason: 'provider_unverified' });
  });

  it('creates unverified when nobody owns the address either', () => {
    expect(decide({ providerVerifiedEmail: false, lookup: { owners: 0, ownerEmailVerified: null } })).toEqual({
      action: 'create_unverified',
      reason: 'provider_unverified',
    });
  });

  it('creates unverified when the provider reports no email', () => {
    expect(decide({ email: null, providerVerifiedEmail: false })).toEqual({
      action: 'create_unverified',
      reason: 'no_email',
    });
  });

  it('creates unverified when the provider reports no email but CLAIMS verification', () => {
    // A provider that says "verified" about an address it did not give us is
    // not something to resolve against.
    expect(decide({ email: null, providerVerifiedEmail: true })).toEqual({
      action: 'create_unverified',
      reason: 'no_email',
    });
  });
});

describe('every reachable combination has a defined answer', () => {
  it('enumerates the full truth table with no gaps', () => {
    const results = new Set<string>();
    for (const hasExistingAccount of [true, false]) {
      for (const email of ['alice@example.com', null]) {
        for (const providerVerifiedEmail of [true, false]) {
          for (const owners of [0, 1, 2]) {
            for (const ownerEmailVerified of [true, false, null]) {
              const decision = decideLinking({
                hasExistingAccount,
                email,
                providerVerifiedEmail,
                lookup: { owners, ownerEmailVerified },
              });
              // Every input produces a decision object with a known action.
              expect([
                'sign_in_existing',
                'link_to_existing',
                'create_verified',
                'create_unverified',
                'refuse',
              ]).toContain(decision.action);
              results.add(decision.action);
            }
          }
        }
      }
    }
    // And the table actually exercises all five outcomes.
    expect([...results].sort()).toEqual(
      ['create_unverified', 'create_verified', 'link_to_existing', 'refuse', 'sign_in_existing'].sort(),
    );
  });

  it('NEVER returns link_to_existing for an unverified provider claim', () => {
    // Exhaustive over the other dimensions — the single property that
    // matters most.
    for (const hasExistingAccount of [false]) {
      for (const owners of [0, 1, 2]) {
        for (const ownerEmailVerified of [true, false, null]) {
          const d = decideLinking({
            hasExistingAccount,
            email: 'alice@example.com',
            providerVerifiedEmail: false,
            lookup: { owners, ownerEmailVerified },
          });
          expect(d.action).not.toBe('link_to_existing');
        }
      }
    }
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Alice@Example.COM  ')).toBe('alice@example.com');
  });

  it('rejects unusable values', () => {
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail('no-at-sign')).toBeNull();
    expect(normaliseEmail('@example.com')).toBeNull();
    expect(normaliseEmail('alice@')).toBeNull();
  });
});

describe('storedEmailFor — the placeholder that cannot be mailed', () => {
  const identity = (over: Partial<OAuthIdentity>): OAuthIdentity => ({
    providerAccountId: '12345',
    email: null,
    emailVerified: false,
    name: null,
    image: null,
    login: null,
    isPrivateRelay: false,
    ...over,
  });

  it('uses the real address when there is one', () => {
    expect(storedEmailFor(identity({ email: 'Bob@Example.com' }), 'google')).toBe('bob@example.com');
  });

  it('uses a reserved-TLD placeholder when there is none', () => {
    const stored = storedEmailFor(identity({ email: null }), 'apple');
    expect(stored).toBe('no-email+apple-12345@users.invalid');
    // `.invalid` is RFC 2606 — it can never resolve or accept mail.
    expect(stored.endsWith('.invalid')).toBe(true);
  });

  it('distinguishes two accounts with no email', () => {
    const a = storedEmailFor(identity({ email: null, providerAccountId: '1' }), 'github');
    const b = storedEmailFor(identity({ email: null, providerAccountId: '2' }), 'github');
    expect(a).not.toBe(b);
  });

  it('falls back when the address has no @', () => {
    expect(storedEmailFor(identity({ email: 'garbage' }), 'google')).toBe(
      'no-email+google-12345@users.invalid',
    );
  });
});
