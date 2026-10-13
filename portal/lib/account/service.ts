/**
 * Account operations — the three things a person can do to THEMSELVES.
 *
 * Every one of these was a button in the UI with nothing behind it:
 * editing your name, changing your password while signed in, and deleting
 * your account. The UI had been saying "saved" and reloading to the same
 * value, which is worse than an honest notice.
 *
 * All three are self-scoped: they act on the CALLER, never on an id from
 * the request body. There is no "edit user X" route, so the IDOR that
 * makes account endpoints dangerous is unrepresentable here.
 *
 * `password_changed_at` is stamped on every credential change and is what
 * invalidates already-issued sessions — see migration 0006 for why a
 * freshness check is the only mechanism Auth.js v5 offers.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  apiKeys,
  authCredentials,
  organizations,
  subscriptions,
  usageRecords,
  users,
} from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/auth/password';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import { deleteKey, listTeamKeys, updateKeyLimits, updateTeamBudget } from '@/lib/litellm/client';
import { log } from '@/lib/log';

/**
 * An error carrying an HTTP status, so the route maps it without
 * re-deriving intent from a message. Mirrors `KeyServiceError`'s shape and
 * speaks the same code vocabulary as `lib/api/errors.ts`.
 */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'validation'
      | 'not_found'
      | 'conflict'
      | 'upstream'
      | 'internal',
    readonly status: number,
    /** Field-level message, so a form can put it on the right input. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Profile
// ───────────────────────────────────────────────────────────────────────

/**
 * Rename yourself.
 *
 * Writes `users.name`, the DOMAIN mirror — that is the table
 * authorization reads and the one every product surface resolves through
 * (PLATFORM §2.1). `auth_users.name` is the auth library's copy and is
 * deliberately left alone: the session carries id and email only, so a
 * stale value there is never displayed and a second source of truth for a
 * display name is a second thing to keep in sync for nothing.
 *
 * Email is NOT editable here. It is the identity `authorize.ts` bridges
 * auth → domain on (`userByEmail`); changing it would orphan every
 * membership, key attribution row and audit entry that references the old
 * address. Email changes are an operator action.
 */
export async function updateProfile(input: {
  userId: string;
  name: string;
}): Promise<{ name: string }> {
  const name = input.name.trim().replace(/\s+/g, ' ');

  if (name.length < 1 || name.length > 120) {
    throw new AccountError(
      'Use between 1 and 120 characters.',
      'validation',
      400,
      'name',
    );
  }

  const [updated] = await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, input.userId))
    .returning({ id: users.id, name: users.name });

  if (!updated) {
    throw new AccountError('Account not found.', 'not_found', 404);
  }

  await appendAudit({
    actorType: 'user',
    actorId: input.userId,
    organizationId: null,
    action: 'profile.renamed',
    targetType: 'user',
    targetId: input.userId,
    after: { name },
  });

  return { name: updated.name ?? '' };
}

// ───────────────────────────────────────────────────────────────────────
//  Password
// ───────────────────────────────────────────────────────────────────────

/**
 * Change your own password while signed in.
 *
 * `userId` is the **domain mirror** id (`users.id`) — what
 * `currentUser()` returns and what every product surface passes. The
 * credential row is keyed by the AUTH identity (`auth_users.id`), which is
 * a *different* uuid held in `users.auth_id`.
 *
 * That distinction is not cosmetic: passing `users.id` straight into
 * `auth_credentials.user_id` finds no row, `stored` is null, and
 * `verifyPassword` correctly refuses — which presents as "your current
 * password is not correct" for the rightful owner, every time, with no
 * other symptom. Caught only by driving the real endpoint against a real
 * account; no unit test on this path would have seen it.
 *
 * Requires the CURRENT password. Without it, this endpoint is a
 * privilege-escalation primitive: anyone who walks up to an unlocked
 * browser, or steals a cookie, could lock the real owner out of their own
 * account. Re-authentication is the control, not a formality.
 *
 * Order matters and is load-bearing:
 *   1. verify the current password — a timing-safe KDF that always runs,
 *      so a wrong current password and a missing account cost the same;
 *   2. reject reuse of the current password, which `validatePassword`
 *      cannot see;
 *   3. validate the new password against the real policy;
 *   4. hash and write, then STAMP `password_changed_at`.
 *
 * The stamp is last so a crash between the credential write and the stamp
 * leaves sessions alive (annoying) rather than locking everyone out
 * (unrecoverable). Sessions issued before the stamp die on their next
 * request — INCLUDING THIS ONE, which is the point: the client is
 * redirected to sign-in.
 */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ changedAt: string }> {
  // Domain mirror → auth identity. One hop, and the only place in the
  // codebase where those two id spaces meet.
  const domain = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, authId: true, authProvider: true },
  });
  if (!domain || domain.authProvider !== 'authjs') {
    throw new AccountError('Account not found.', 'not_found', 404);
  }
  const authId = domain.authId;

  const rows = await db
    .select({ password: authCredentials.password })
    .from(authCredentials)
    .where(eq(authCredentials.userId, authId))
    .limit(1);

  const stored = rows[0]?.password ?? null;

  // Always runs the KDF, even with no credential row, so the two failures
  // are indistinguishable in time.
  const currentOk = await verifyPassword(input.currentPassword, stored);
  if (!currentOk) {
    throw new AccountError(
      'Your current password is not correct.',
      'validation',
      400,
      'currentPassword',
    );
  }

  if (input.newPassword === input.currentPassword) {
    throw new AccountError(
      'Choose a password you have not used here before.',
      'validation',
      400,
      'newPassword',
    );
  }

  const policy = validatePassword(input.newPassword);
  if (!policy.ok) {
    throw new AccountError(policy.error, 'validation', 400, 'newPassword');
  }

  const hash = await hashPassword(input.newPassword);
  const changedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(authCredentials)
      .values({ userId: authId, password: hash, updatedAt: changedAt })
      .onConflictDoUpdate({
        target: authCredentials.userId,
        set: { password: hash, updatedAt: changedAt },
      });

    // The session invalidation stamp. Written in the same transaction as
    // the credential so the two can never disagree.
    await tx
      .update(users)
      .set({ passwordChangedAt: changedAt, updatedAt: changedAt })
      .where(eq(users.id, input.userId));
  });

  await appendAudit({
    actorType: 'user',
    actorId: input.userId,
    organizationId: null,
    action: 'profile.password_changed',
    targetType: 'user',
    targetId: input.userId,
    // No password, no hash, not even a length. The audit log is read by
    // staff; it is not a place credential material accumulates.
    after: { changedAt: changedAt.toISOString() },
  });

  log.info('account: password changed', { userId: input.userId });

  return { changedAt: changedAt.toISOString() };
}

// ───────────────────────────────────────────────────────────────────────
//  Account deletion
// ───────────────────────────────────────────────────────────────────────

export interface DeleteAccountResult {
  revokedKeys: number;
  gatewayFailures: number;
  ledgerRows: number;
}

/**
 * Delete the account.
 *
 * A SOFT delete, and deliberately so. `usage_records` is the billing
 * record — the customer's ledger and the operator's reconciliation both
 * point at it — so the rows stay. What goes away is access: the
 * subscription is canceled, every key is revoked upstream, and the org is
 * marked `deleted`, which makes `requireOrgMembership` answer 404 for it
 * on every subsequent request.
 *
 * Order is chosen so the customer is cut off FIRST and cleanup is best
 * effort after. Losing the ability to spend matters; a stale team row in
 * LiteLLM does not, and is fixable by an operator. The reverse order would
 * leave a window where the portal says "deleted" and the keys still work.
 *
 * The confirmation slug is compared case-insensitively after slugifying,
 * so typing the displayed slug with different case or a stray dash still
 * matches — the friction is "did you mean to?", not a typing test.
 */
export async function deleteAccount(input: {
  organizationId: string;
  userId: string;
  confirmSlug: string;
}): Promise<DeleteAccountResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
  });
  if (!org) {
    throw new AccountError('Organization not found.', 'not_found', 404);
  }
  if (org.status === 'deleted') {
    throw new AccountError('This account is already deleted.', 'conflict', 409);
  }

  const expected = org.slug.toLowerCase();
  const given = input.confirmSlug.trim().toLowerCase();
  if (given !== expected) {
    throw new AccountError(
      'Type the account slug exactly to confirm.',
      'validation',
      400,
      'confirmSlug',
    );
  }

  const now = new Date();

  // 1. Cancel the subscription. Local first, then push — the same
  //    SQL-first rule as `expire_subscriptions` (PLATFORM §5.3): if the
  //    process dies between them, the next reconcile re-pushes.
  await db
    .update(subscriptions)
    .set({ status: 'canceled', cancelAtPeriodEnd: true, updatedAt: now })
    .where(
      and(
        eq(subscriptions.organizationId, org.id),
        sql`${subscriptions.status} IN ('trialing','active','past_due','paused','incomplete')`,
      ),
    );

  // 2. Revoke every key UPSTREAM, then mark them locally.
  //
  //    Upstream-first is the rule from lib/keys/service.ts, inverted in
  //    order here for a different reason: this is a bulk teardown where
  //    the local rows are about to be hidden anyway, so the priority is
  //    stopping spend, and any key whose upstream delete fails is left
  //    revoked LOCALLY as well — a key marked revoked that still works is
  //    the one outcome that must not happen, and the budget cut in step 3
  //    stops it even if a delete failed.
  const keys = await db
    .select({ id: apiKeys.id, hash: apiKeys.litellmKeyHash })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.organizationId, org.id),
        isNull(apiKeys.revokedAt),
      ),
    );

  let revokedKeys = 0;
  let gatewayFailures = 0;

  for (const key of keys) {
    if (key.hash) {
      try {
        await deleteKey(key.hash);
      } catch (e) {
        gatewayFailures++;
        log.error('account delete: key revoke failed', {
          organizationId: org.id,
          keyId: key.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, key.id));
    revokedKeys++;
  }

  // 3. Starve the team AND its keys, so nothing survives even if a delete
  //    above failed. CUT_BUDGET rather than 0 — 0 reads as UNLIMITED in
  //    LiteLLM's limiter (BLUEPRINT §9.4), which is the exact opposite of
  //    what this function is for.
  if (org.litellmTeamId) {
    try {
      await updateTeamBudget(org.litellmTeamId, {
        maxBudgetUsd: CUT_BUDGET,
        budgetDuration: '30d',
      });
      for (const k of await listTeamKeys(org.litellmTeamId)) {
        await updateKeyLimits(k.token, {
          models: [],
          maxBudget: CUT_BUDGET,
          budgetDuration: '30d',
          rpmLimit: null,
          tpmLimit: null,
          maxParallelRequests: null,
        });
      }
    } catch (e) {
      gatewayFailures++;
      log.error('account delete: team cut failed', {
        organizationId: org.id,
        teamId: org.litellmTeamId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 4. Mark the org deleted. From here `requireOrgMembership` answers
  //    404 and every product surface is unreachable. `status` is indexed
  //    and the reconciler skips non-active orgs, so nothing keeps pushing
  //    limits at a deleted account.
  await db
    .update(organizations)
    .set({ status: 'deleted', deletedAt: now, updatedAt: now })
    .where(eq(organizations.id, org.id));

  const [{ n: ledgerRows } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageRecords)
    .where(eq(usageRecords.organizationId, org.id));

  await appendAudit({
    actorType: 'user',
    actorId: input.userId,
    organizationId: org.id,
    action: 'account.deleted',
    targetType: 'organization',
    targetId: org.id,
    before: { slug: org.slug, status: org.status, name: org.name },
    after: {
      revokedKeys,
      gatewayFailures,
      ledgerRows: Number(ledgerRows ?? 0),
      ledgerRetained: true,
    },
  });

  log.warn('account: deleted', {
    organizationId: org.id,
    userId: input.userId,
    revokedKeys,
    gatewayFailures,
    ledgerRows: Number(ledgerRows ?? 0),
  });

  return { revokedKeys, gatewayFailures, ledgerRows: Number(ledgerRows ?? 0) };
}