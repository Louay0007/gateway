/**
 * The linking decision, as a PURE function.
 *
 * §2.3 of the plan is a policy, and a policy that lives inside database
 * calls cannot be tested without a database — which is exactly how an
 * account-takeover bug ships. So the decision is here, takes only facts its
 * caller already read, and returns what to do. `resolve.ts` then performs
 * the I/O that the decision asked for.
 *
 * The ordering below IS the security property:
 *
 *   1. an account row wins — the provider vouched for this identity to us
 *   2. otherwise link only when the provider verified the address AND the
 *      existing account is itself verified AND exactly one owns it
 *   3. otherwise create; an unverified claim never links
 */
import type { OAuthIdentity } from './types';

/** What a lookup of `auth_users` by the provider's email found. */
export interface EmailLookup {
  /** 0 = nobody owns it, 1 = exactly one, 2+ = a schema violation. */
  owners: number;
  /** For the single owner: whether THAT account's own email is verified. */
  ownerEmailVerified: boolean | null;
}

export type LinkingDecision =
  /** The (provider, provider_account_id) row exists: sign in, touch nothing else. */
  | { action: 'sign_in_existing' }
  /** Link this provider to the existing owner of a verified address. */
  | { action: 'link_to_existing' }
  /** Create a new identity, with its email stamped verified. */
  | { action: 'create_verified' }
  /** Create a new identity, unverified; the caller must gate spending. */
  | { action: 'create_unverified'; reason: 'provider_unverified' | 'no_email' | 'target_unverified' }
  /** Two identities own the address: refuse rather than pick one. */
  | { action: 'refuse'; reason: 'ambiguous_email' };

export interface DecideInput {
  /** Did `auth_accounts` already hold (provider, provider_account_id)? */
  hasExistingAccount: boolean;
  /** The provider's reported email, already lowercased and validated, or NULL. */
  email: string | null;
  /** The provider's own verification claim, normalised by the adapter. */
  providerVerifiedEmail: boolean;
  /** Result of looking that email up in `auth_users`. */
  lookup: EmailLookup;
}

export function decideLinking(input: DecideInput): LinkingDecision {
  // ── 1. An account row is a fact, not a heuristic. ────────────────────
  if (input.hasExistingAccount) return { action: 'sign_in_existing' };

  // ── 3 (checked before 2): no verified address can never link. ───────
  //
  // The GitHub attack this blocks: register at GitHub with
  // victim@company.com (GitHub does not verify addresses it does not own),
  // sign in here, and be linked into the victim's account.
  if (!input.email) {
    return { action: 'create_unverified', reason: 'no_email' };
  }
  if (!input.providerVerifiedEmail) {
    return { action: 'create_unverified', reason: 'provider_unverified' };
  }

  // ── 2. Verified by the provider — now check the target. ─────────────
  //
  // Two owners is a schema violation (the 0041 unique index makes it
  // impossible), but reaching the code that reads it with a broken index
  // must refuse, not guess.
  if (input.lookup.owners > 1) {
    return { action: 'refuse', reason: 'ambiguous_email' };
  }

  if (input.lookup.owners === 0) {
    return { action: 'create_verified' };
  }

  // Exactly one owner. It must ITSELF be verified: an account whose address
  // was never proven has unproven ownership on both sides, so linking into
  // it does not inherit any proof.
  if (input.lookup.ownerEmailVerified !== true) {
    return { action: 'create_unverified', reason: 'target_unverified' };
  }

  return { action: 'link_to_existing' };
}

/**
 * The address to store on `auth_users`.
 *
 * A provider that discloses nothing (or an identity created from a
 * non-`email` scope) still needs a value: the column is NOT NULL and
 * uniquely indexed. A reserved-TLD placeholder satisfies both and can never
 * be mailed or verified, so the account stays visibly incomplete rather
 * than looking finished.
 */
export function storedEmailFor(identity: OAuthIdentity, provider: string): string {
  const email = identity.email?.trim().toLowerCase();
  if (email && email.includes('@')) return email;
  // RFC 2606 reserves `.invalid`: guaranteed to never resolve or deliver.
  return `no-email+${provider}-${identity.providerAccountId}@users.invalid`;
}

/** Lowercase + basic shape check. Returns NULL for anything unusable. */
export function normaliseEmail(raw: string | null): string | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes('@') || trimmed.startsWith('@') || trimmed.endsWith('@')) return null;
  return trimmed;
}
