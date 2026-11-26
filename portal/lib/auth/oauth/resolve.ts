/**
 * Identity resolution — the I/O half of §2.3.
 *
 * The DECISION lives in `policy.ts` and is pure, because a rule that can
 * only be exercised against a database is a rule nobody exercises. This file
 * reads what the decision needs, then performs what it asked for, and does
 * nothing else:
 *
 *   read:  auth_accounts row? auth_users by email (how many owners, verified?)
 *   write: account row upsert, auth_users insert/update, domain mirror
 *
 * Everything writes in ONE transaction where more than one row changes: an
 * identity with no account row can sign in but has no provider link, and an
 * identity with no domain mirror is a dead account. Neither is recoverable
 * by hand (the same argument lib/auth/create-user.ts makes for the password
 * path).
 *
 * ── TWO THINGS THIS FILE OWNS THAT ARE EASY TO GET WRONG ─────────────
 *
 * 1. THE CANONICAL EMAIL. `sessionEmail` on every outcome is the address
 *    actually stored on `auth_users` — lowercased, or a reserved-TLD
 *    placeholder. The callback MUST mint the session with it, never with the
 *    provider's raw value: `authorize.ts` resolves a session by exact match
 *    on `users.email`, so a mixed-case or placeholder mismatch produces a
 *    session that parses but resolves to nobody — signed in, 401 on every
 *    request.
 *
 * 2. RE-SYNC ON EVERY SIGN-IN. A returning user is not frozen: a provider
 *    can start verifying an address it withheld last time (GitHub's private
 *    primary email is the common case), a display name can be filled in, or
 *    a placeholder identity can finally be given a real address. Without a
 *    sync a GitHub user who signs in with a private email first is stranded
 *    on an account that can never be verified — and therefore can never
 *    create a key, chat, or pay. `syncIdentity` below is that reconciliation,
 *    and it is deliberately conservative: it fills gaps and promotes
 *    placeholders, and it never overwrites a name the customer chose.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authUsers, authAccounts, users } from '@/db/schema';
import { log } from '@/lib/log';
import {
  decideLinking,
  normaliseEmail,
  planIdentitySync,
  storedEmailFor,
  type EmailLookup,
} from './policy';
import type { OAuthIdentity, ProviderId } from './types';

export type ResolveOutcome =
  /** Signed in to an existing identity via its account row. */
  | { kind: 'existing_account'; userId: string; domainUserId: string; sessionEmail: string; synced: SyncReport }
  /** Linked to an existing identity by verified email. */
  | { kind: 'linked_to_existing'; userId: string; domainUserId: string; sessionEmail: string }
  /** A brand-new identity, email stamped verified. */
  | { kind: 'created'; userId: string; domainUserId: string; sessionEmail: string }
  /**
   * A new identity whose email is NOT proven. The caller must gate keys,
   * checkout, chat and trials (§6.3) until our own verification completes.
   */
  | { kind: 'created_unverified'; userId: string; domainUserId: string; sessionEmail: string };

/** What `syncIdentity` changed for a returning user. Logged, never shown. */
export interface SyncReport {
  /** `auth_users.name` was empty and the provider supplied one. */
  nameFilled: boolean;
  /** The reserved-TLD placeholder was replaced by a real verified address. */
  emailPromoted: boolean;
  /** Our record of verification was upgraded from NULL to a stamp. */
  verified: boolean;
}

/**
 * The identity cannot be resolved, and the reason is the user's to act on.
 *
 * `email_unverified_elsewhere` is a REFUSAL, not a failure: an account here
 * already holds the address but has never confirmed it. Creating a second
 * identity on the same address is impossible (0041's unique index), so the
 * callback must explain rather than answer a generic "sign-in failed".
 */
export class ResolveRefusedError extends Error {
  constructor(readonly reason: 'ambiguous_email' | 'email_unverified_elsewhere') {
    super(`resolveIdentity refused: ${reason}`);
    this.name = 'ResolveRefusedError';
  }
}

export interface ResolveContext {
  provider: ProviderId;
  identity: OAuthIdentity;
  /** Persisted on the account row. Never logged. */
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenType?: string;
    scope?: string;
    idToken?: string;
  };
}

/** Look up ownership of an address the same way the 0041 index does. */
async function lookupEmail(email: string): Promise<EmailLookup> {
  const rows = await db
    .select({ id: authUsers.id, emailVerified: authUsers.emailVerified })
    .from(authUsers)
    .where(sql`lower(${authUsers.email}) = ${email}`)
    .limit(2);

  if (rows.length === 0) return { owners: 0, ownerEmailVerified: null };
  if (rows.length > 1) return { owners: rows.length, ownerEmailVerified: null };
  return { owners: 1, ownerEmailVerified: rows[0]!.emailVerified !== null };
}

/** The token columns, shared by both write paths so they cannot drift. */
function tokenColumns(ctx: ResolveContext, email: string | null) {
  return {
    access_token: ctx.tokens.accessToken,
    refresh_token: ctx.tokens.refreshToken ?? null,
    expires_at: ctx.tokens.expiresAt ? Math.floor(ctx.tokens.expiresAt / 1000) : null,
    token_type: ctx.tokens.tokenType ?? null,
    scope: ctx.tokens.scope ?? null,
    id_token: ctx.tokens.idToken ?? null,
    provider_email: email,
    provider_email_verified: ctx.identity.emailVerified,
    provider_login: ctx.identity.login,
  };
}

export async function resolveIdentity(ctx: ResolveContext): Promise<ResolveOutcome> {
  const { provider, identity, tokens } = ctx;
  const providerAccountId = identity.providerAccountId;
  const email = normaliseEmail(identity.email);

  // ── Read ────────────────────────────────────────────────────────────
  const existingAccount = await db.query.authAccounts.findFirst({
    where: and(
      eq(authAccounts.provider, provider),
      eq(authAccounts.providerAccountId, providerAccountId),
    ),
    columns: { userId: true },
  });

  // Ownership is read whenever there IS an address — including for an
  // UNVERIFIED provider claim. That is not for linking (an unverified claim
  // never links); it is because `create_unverified` still has to pick the
  // column value, and re-using an address another identity owns aborts the
  // INSERT against the 0041 unique index. The policy turns that fact into
  // `email_conflict`, which stores the placeholder instead.
  const lookup = email ? await lookupEmail(email) : { owners: 0, ownerEmailVerified: null };

  const decision = decideLinking({
    hasExistingAccount: existingAccount !== undefined,
    email,
    providerVerifiedEmail: identity.emailVerified,
    lookup,
  });

  // ── Write ───────────────────────────────────────────────────────────
  switch (decision.action) {
    case 'sign_in_existing': {
      const userId = existingAccount!.userId;
      // Refresh the token columns: the previous access token has expired by
      // now, and this is the only moment a fresh one exists.
      await db
        .update(authAccounts)
        .set(tokenColumns(ctx, email))
        .where(
          and(
            eq(authAccounts.provider, provider),
            eq(authAccounts.providerAccountId, providerAccountId),
          ),
        );

      const domainUserId = await mirrorDomainUser(userId);
      const { sessionEmail, synced } = await syncIdentity(userId, domainUserId, ctx, email, lookup.owners);
      return { kind: 'existing_account', userId, domainUserId, sessionEmail, synced };
    }

    case 'link_to_existing': {
      const owner = await db.query.authUsers.findFirst({
        where: sql`lower(${authUsers.email}) = ${email}`,
        columns: { id: true, email: true },
      });
      if (!owner) {
        // The row vanished between the lookup and here (a concurrent delete).
        // Fall through to creation rather than failing sign-in. `owners: 0`
        // because the address is provably free again.
        return createIdentity(ctx, email, false, 'owner_vanished', 0);
      }
      await insertAccountRow(owner.id, ctx, email);
      log.info('oauth identity linked', { provider, providerAccountId });
      // §6.2 row 4: the existing account's canonical email is NOT rewritten.
      // `provider_email` on the account row records the difference.
      //
      // The session is minted with the OWNER's stored address, not the
      // provider's claim: `authorize.ts` resolves by exact match, so a
      // provider that capitalises differently would otherwise mint a session
      // that resolves to nobody.
      return {
        kind: 'linked_to_existing',
        userId: owner.id,
        domainUserId: await mirrorDomainUser(owner.id),
        sessionEmail: owner.email,
      };
    }

    case 'create_verified':
      return createIdentity(ctx, email, true, null, lookup.owners);

    case 'create_unverified':
      return createIdentity(ctx, email, false, decision.reason, lookup.owners);

    case 'refuse':
      // `ambiguous_email` is a broken unique index, not a user error: refuse
      // loudly and log the fact. `email_unverified_elsewhere` is a user's
      // account holding the address unconfirmed — a refusal with a next step.
      log.warn('oauth resolve: refused', {
        provider,
        providerAccountId,
        reason: decision.reason,
      });
      throw new ResolveRefusedError(decision.reason);
  }
}

/**
 * Reconcile a returning identity with what the provider says today.
 *
 * The RULE lives in `planIdentitySync` (policy.ts) and is pure; this reads
 * the two rows, asks the rule, and performs what it asked for. Only ever
 * FILLS or PROMOTES — never overwrites a name the customer chose, and never
 * downgrades a verification we already recorded. See the policy for why.
 *
 * Both tables move together or not at all, because `authorize.ts` reads
 * `users` and the callback's next session reads `auth_users`.
 */
async function syncIdentity(
  authUserId: string,
  domainUserId: string,
  ctx: ResolveContext,
  email: string | null,
  owners: number,
): Promise<{ sessionEmail: string; synced: SyncReport }> {
  const report: SyncReport = { nameFilled: false, emailPromoted: false, verified: false };

  return db.transaction(async (tx) => {
    const authRow = await tx.query.authUsers.findFirst({
      where: eq(authUsers.id, authUserId),
    });
    const domainRow = await tx.query.users.findFirst({
      where: eq(users.id, domainUserId),
    });
    if (!authRow || !domainRow) {
      // A row vanished mid-request; answer with what we have rather than
      // throwing on a path whose job is to mint a session.
      return { sessionEmail: authRow?.email ?? '', synced: report };
    }

    // `owners` counts identities holding the provider's address. The row we
    // are syncing may be one of them (its own email IS that address), so
    // "owned by somebody else" means owners > 0 AND it is not already ours.
    const ownedByOther = owners > 0 && authRow.email.toLowerCase() !== (email ?? '').toLowerCase();

    const patch = planIdentitySync(
      {
        email: authRow.email,
        name: domainRow.name,
        authName: authRow.name,
        emailVerified: authRow.emailVerified !== null,
      },
      {
        email,
        name: ctx.identity.name,
        emailVerified: ctx.identity.emailVerified,
      },
      ownedByOther,
    );

    if (patch.changed) {
      const patchAuth: Partial<typeof authUsers.$inferInsert> = {};
      const patchDomain: Partial<typeof users.$inferInsert> = {};

      // `patch.name` is a value to backfill INTO EMPTY COLUMNS, never to force
      // over an existing one. The two rows are checked separately because
      // `updateProfile` writes only `users.name`, so a chosen name leaves
      // `auth_users.name` empty — writing blindly would clobber the choice.
      if (patch.name !== null) {
        if (!authRow.name?.trim()) patchAuth.name = patch.name;
        if (!domainRow.name?.trim()) patchDomain.name = patch.name;
        report.nameFilled = true;
      }
      if (patch.email !== null) {
        patchAuth.email = patch.email;
        patchDomain.email = patch.email;
        report.emailPromoted = true;
      }
      if (patch.emailVerified && authRow.emailVerified === null) {
        const stamp = new Date();
        patchAuth.emailVerified = stamp;
        patchDomain.emailVerifiedAt = stamp;
        report.verified = true;
      }

      if (Object.keys(patchAuth).length > 0) {
        await tx.update(authUsers).set(patchAuth).where(eq(authUsers.id, authUserId));
      }
      if (Object.keys(patchDomain).length > 0) {
        patchDomain.updatedAt = new Date();
        await tx.update(users).set(patchDomain).where(eq(users.id, domainUserId));
      }

      log.info('oauth identity re-synced', { authUserId, ...report });
    }

    return { sessionEmail: patch.sessionEmail, synced: report };
  });
}

async function createIdentity(
  ctx: ResolveContext,
  email: string | null,
  verified: boolean,
  reason: string | null,
  owners: number,
): Promise<ResolveOutcome> {
  const { provider, identity } = ctx;
  const userId = crypto.randomUUID();
  const verifiedAt = verified ? new Date() : null;

  // `owners > 0` means another identity already stores this address. The
  // column is uniquely indexed case-insensitively (0041), so storing it again
  // would abort the INSERT — which is exactly what the GitHub-takeover case
  // would hit: an unverified claim on an address somebody here already owns.
  // The placeholder is then the only insertable value; the real address stays
  // on the account row via `tokenColumns` for support.
  const storedEmail = storedEmailFor(identity, provider, owners > 0);

  await db.transaction(async (tx) => {
    await tx.insert(authUsers).values({
      id: userId,
      name: identity.name,
      email: storedEmail,
      emailVerified: verifiedAt,
      image: identity.image,
      emailIsPrivateRelay: identity.isPrivateRelay,
      signupMethod: provider,
    });

    await tx.insert(authAccounts).values({
      userId,
      type: 'oauth',
      provider,
      providerAccountId: identity.providerAccountId,
      ...tokenColumns(ctx, email),
    });

    await tx
      .insert(users)
      .values({
        authProvider: 'authjs',
        authId: userId,
        email: storedEmail,
        name: identity.name,
        emailVerifiedAt: verifiedAt,
        // `users.image` is a data URL (lib/account/service.ts is its only
        // writer). The provider's avatar is a remote URL and is deliberately
        // NOT copied here: every consumer expects `data:image/…`. It stays
        // on auth_accounts and auth_users.
      })
      .onConflictDoNothing({ target: users.email });
  });

  log.info('oauth identity created', {
    provider,
    providerAccountId: identity.providerAccountId,
    verified,
    reason,
  });

  const domainUserId = await mirrorDomainUser(userId);
  return verified
    ? { kind: 'created', userId, domainUserId, sessionEmail: storedEmail }
    : { kind: 'created_unverified', userId, domainUserId, sessionEmail: storedEmail };
}

async function insertAccountRow(userId: string, ctx: ResolveContext, email: string | null): Promise<void> {
  const { provider, identity } = ctx;
  await db
    .insert(authAccounts)
    .values({
      userId,
      type: 'oauth',
      provider,
      providerAccountId: identity.providerAccountId,
      ...tokenColumns(ctx, email),
    })
    // A concurrent callback for the same identity may have inserted it
    // between the read and this write. The PK makes that a no-op rather than
    // a 500 the user sees.
    .onConflictDoNothing({ target: [authAccounts.provider, authAccounts.providerAccountId] });
}

/**
 * The `users.id` for an auth identity, creating the mirror when a
 * pre-0002 account has none. Authorization reads `users`, never
 * `auth_users`, so the two must agree (the credentials provider upserts for
 * the same reason).
 */
async function mirrorDomainUser(authUserId: string): Promise<string> {
  const found = await db.query.users.findFirst({
    where: and(eq(users.authProvider, 'authjs'), eq(users.authId, authUserId)),
    columns: { id: true },
  });
  if (found) return found.id;

  const authUser = await db.query.authUsers.findFirst({ where: eq(authUsers.id, authUserId) });
  if (!authUser) throw new Error('mirrorDomainUser: identity vanished');

  const inserted = await db
    .insert(users)
    .values({
      authProvider: 'authjs',
      authId: authUserId,
      email: authUser.email,
      name: authUser.name,
      emailVerifiedAt: authUser.emailVerified,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  if (inserted[0]) return inserted[0].id;

  // Conflict on email: a mirror row owns it under a different auth_id.
  const byEmail = await db.query.users.findFirst({
    where: eq(users.email, authUser.email),
    columns: { id: true },
  });
  if (!byEmail) throw new Error('mirrorDomainUser: no domain row after conflict');
  return byEmail.id;
}
