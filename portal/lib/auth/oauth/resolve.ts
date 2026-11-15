/**
 * Identity resolution — the I/O half of §2.3.
 *
 * The DECISION lives in `policy.ts` and is pure, because a rule that can
 * only be exercised against a database is a rule nobody exercises. This file
 * reads what the decision needs, then performs what it asked for, and does
 * nothing else:
 *
 *   read:  auth_accounts row? auth_users by email (how many owners, verified?)
 *   write: account row upsert, auth_users insert, domain mirror
 *
 * Everything writes in ONE transaction where more than one row changes: an
 * identity with no account row can sign in but has no provider link, and an
 * identity with no domain mirror is a dead account. Neither is recoverable
 * by hand (the same argument lib/auth/create-user.ts makes for the password
 * path).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authUsers, authAccounts, users } from '@/db/schema';
import { log } from '@/lib/log';
import { decideLinking, normaliseEmail, storedEmailFor, type EmailLookup } from './policy';
import type { OAuthIdentity, ProviderId } from './types';

export type ResolveOutcome =
  /** Signed in to an existing identity via its account row. */
  | { kind: 'existing_account'; userId: string; domainUserId: string }
  /** Linked to an existing identity by verified email. */
  | { kind: 'linked_to_existing'; userId: string; domainUserId: string }
  /** A brand-new identity, email stamped verified. */
  | { kind: 'created'; userId: string; domainUserId: string }
  /**
   * A new identity whose email is NOT proven. The caller must gate keys,
   * checkout, chat and trials (§6.3) until our own verification completes.
   */
  | { kind: 'created_unverified'; userId: string; domainUserId: string };

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

  const decision = decideLinking({
    hasExistingAccount: existingAccount !== undefined,
    email,
    providerVerifiedEmail: identity.emailVerified,
    // Only looked up when the decision can possibly use it — a link target
    // is the only branch that reads it.
    lookup: email && identity.emailVerified ? await lookupEmail(email) : { owners: 0, ownerEmailVerified: null },
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
      return { kind: 'existing_account', userId, domainUserId: await mirrorDomainUser(userId) };
    }

    case 'link_to_existing': {
      const owner = await db.query.authUsers.findFirst({
        where: sql`lower(${authUsers.email}) = ${email}`,
        columns: { id: true },
      });
      if (!owner) {
        // The row vanished between the lookup and here (a concurrent delete).
        // Fall through to creation rather than failing sign-in.
        return createIdentity(ctx, email, false, 'owner_vanished');
      }
      await insertAccountRow(owner.id, ctx, email);
      log.info('oauth identity linked', { provider, providerAccountId });
      // §6.2 row 4: the existing account's canonical email is NOT rewritten.
      // `provider_email` on the account row records the difference.
      return { kind: 'linked_to_existing', userId: owner.id, domainUserId: await mirrorDomainUser(owner.id) };
    }

    case 'create_verified':
      return createIdentity(ctx, email, true, null);

    case 'create_unverified':
      return createIdentity(ctx, email, false, decision.reason);

    case 'refuse':
      // More than one identity owns this address. That is a broken unique
      // index, not a user error — refuse loudly and log the fact.
      log.error('oauth resolve: more than one identity owns an email', {
        provider,
        providerAccountId,
      });
      throw new Error('resolveIdentity: ambiguous email ownership');
  }
}

async function createIdentity(
  ctx: ResolveContext,
  email: string | null,
  verified: boolean,
  reason: string | null,
): Promise<ResolveOutcome> {
  const { provider, identity } = ctx;
  const userId = crypto.randomUUID();
  const verifiedAt = verified ? new Date() : null;
  const storedEmail = storedEmailFor(identity, provider);

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
    ? { kind: 'created', userId, domainUserId }
    : { kind: 'created_unverified', userId, domainUserId };
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
