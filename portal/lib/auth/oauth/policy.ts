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

export type CreateUnverifiedReason =
  /** The provider never proved it owns the address. */
  | 'provider_unverified'
  /** The provider disclosed no usable address at all. */
  | 'no_email';

export type RefuseReason =
  /** Two identities own the address: a schema violation, never a user error. */
  | 'ambiguous_email'
  /**
   * The provider proved the address, and an UNCONFIRMED account here already
   * holds it. Linking would hand control of a password-protected account to
   * whoever can read that inbox — which is the legitimate owner, but the
   * account may have been created by someone else with a typo'd address.
   * Refusing is safe and actionable ("confirm that account or reset it"),
   * whereas silently minting a second identity strands the user on an
   * account whose address can never be verified because it is taken.
   */
  | 'email_unverified_elsewhere';

export type LinkingDecision =
  /** The (provider, provider_account_id) row exists: sign in, touch nothing else. */
  | { action: 'sign_in_existing' }
  /** Link this provider to the existing owner of a verified address. */
  | { action: 'link_to_existing' }
  /** Create a new identity, with its email stamped verified. */
  | { action: 'create_verified' }
  /** Create a new identity, unverified; the caller must gate spending. */
  | { action: 'create_unverified'; reason: CreateUnverifiedReason }
  /** Do not create, do not link: explain, or fail loudly. */
  | { action: 'refuse'; reason: RefuseReason };

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
  //
  // REFUSE, do not create. Creating would need the same address on a second
  // `auth_users` row, which the 0041 unique index rejects — so the insert
  // aborted and the callback surfaced a generic failure. Refusing is also
  // the safer answer: the existing account is password-protected, and
  // linking would let whoever can read that inbox in beside its owner. The
  // owner's recovery is the password reset they can already reach.
  if (input.lookup.ownerEmailVerified !== true) {
    return { action: 'refuse', reason: 'email_unverified_elsewhere' };
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
 *
 * `emailAlreadyStored` forces the placeholder even when the provider DID
 * disclose an address. `auth_users.email` is uniquely indexed
 * case-insensitively (0041), so re-using an address another identity already
 * owns aborts the INSERT — which surfaced as a generic "sign-in failed" on
 * the callback. The address is still recorded, on
 * `auth_accounts.provider_email`, so support keeps the fact.
 */
export function storedEmailFor(
  identity: OAuthIdentity,
  provider: string,
  emailAlreadyStored = false,
): string {
  const email = identity.email?.trim().toLowerCase();
  if (!emailAlreadyStored && email && email.includes('@')) return email;
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

/** Is this the reserved-TLD address `storedEmailFor` writes when there is none? */
export function isPlaceholderEmail(email: string): boolean {
  // RFC 2606 reserves `.invalid`: it can never resolve or accept mail.
  return email.toLowerCase().endsWith('@users.invalid');
}

/** What we currently hold for an identity, as the sync needs to see it. */
export interface StoredIdentity {
  email: string;
  /**
   * Display name on the DOMAIN mirror (`users.name`). This is the one the
   * customer edits in settings and the one every product surface renders.
   */
  name: string | null;
  /**
   * Display name on the AUTH row (`auth_users.name`). Separate because the
   * app writes the two independently: `updateProfile` touches only the
   * domain mirror, so a name the customer chose lives here as touched-by-
   * nobody. Treating one column as the other's proxy is how a chosen name
   * gets overwritten by the provider's.
   */
  authName: string | null;
  emailVerified: boolean;
}

/** What the provider says today. */
export interface ProviderClaims {
  /** Normalised address, or NULL when the provider disclosed none. */
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

export interface SyncPatch {
  /**
   * The name to write INTO EMPTY COLUMNS ONLY, or NULL when there is nothing
   * to fill. Never a value to force over an existing name.
   */
  name: string | null;
  /** Column values to write, or NULL where nothing changes. */
  email: string | null;
  nameFilled: boolean;
  emailVerified: boolean;
  /** The address to mint the session with — always the POST-sync value. */
  sessionEmail: string;
  /** True when the sync changed anything (for the log line). */
  changed: boolean;
}

/**
 * Reconcile a RETURNING identity with what the provider says now — pure.
 *
 * The rule is deliberately one-directional: a sign-in may FILL a gap or
 * PROMOTE a placeholder, and may never take anything away.
 *
 *   - name:    an empty column is filled — first from the other column (the
 *              same person's name, so this is a backfill, not a guess), then
 *              from the provider. A name that already exists is never
 *              replaced, which is what keeps a name the customer chose in
 *              settings across every later sign-in.
 *   - verified: upgraded NULL → true only. A provider that stops asserting
 *              verification does not un-verify an address we confirmed by
 *              email link.
 *   - email:   rewritten in exactly one case — ours is the `.invalid`
 *              placeholder and the provider now supplies a real, verified
 *              address nobody else owns (`emailOwnedByOther` false). That is
 *              what un-strands a GitHub user whose primary email was private
 *              on their first sign-in.
 *
 * WHY A PURE FUNCTION. This decides whether a person silently ends up on a
 * different address, or with a different name, than they chose — the sort of
 * rule that must be provable without standing up Postgres. The same argument
 * `decideLinking` makes, and `syncIdentity` in resolve.ts performs it.
 */
export function planIdentitySync(
  stored: StoredIdentity,
  claims: ProviderClaims,
  emailOwnedByOther: boolean,
): SyncPatch {
  const patch: SyncPatch = {
    name: null,
    email: null,
    nameFilled: false,
    emailVerified: false,
    sessionEmail: stored.email,
    changed: false,
  };

  // ── Name (fill empty columns only) ─────────────────────────────────
  //
  // A copy already on either row is this person's name; trusting it over the
  // provider's is always correct. Only when both are empty do we take the
  // provider's, and only when it supplied one.
  const known = stored.name?.trim() || stored.authName?.trim() || null;
  const fromProvider = claims.name?.trim() || null;
  const fill = known ?? fromProvider;
  if (fill && (!stored.name?.trim() || !stored.authName?.trim())) {
    patch.name = fill;
    patch.nameFilled = true;
    patch.changed = true;
  }

  // ── Verification (upgrade only) ────────────────────────────────────
  if (claims.emailVerified && !stored.emailVerified) {
    patch.emailVerified = true;
    patch.changed = true;
  }

  // ── Placeholder → real address (the only rewrite) ──────────────────
  if (
    claims.email &&
    claims.emailVerified &&
    !emailOwnedByOther &&
    isPlaceholderEmail(stored.email)
  ) {
    patch.email = claims.email;
    patch.sessionEmail = claims.email;
    // A promoted address is provider-verified by definition.
    patch.emailVerified = true;
    patch.changed = true;
  }

  return patch;
}
