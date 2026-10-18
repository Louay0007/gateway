/**
 * Authorization primitives.
 *
 * PLATFORM.md §10.1 and §1.2:
 *   - `requireOrgMembership()` is the ONLY way to obtain an `orgId`.
 *   - `requireStaff()` is the only way to obtain a staff role.
 *   - Staff are never org members, and there is no impersonation.
 *
 * The single most common SaaS breach is a missing tenant filter — a route
 * that trusts `params.orgId` instead of the session. These helpers exist
 * so that pattern is unrepresentable in practice: callers get an orgId
 * from the session, never from the request.
 */

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import {
  organizationMembers,
  organizations,
  staffUsers,
  users,
  type OrgRole,
} from '@/db/schema';
import { auth } from '@/auth';
import { log } from '@/lib/log';
import { sessionIsFresh } from '@/lib/auth/session-freshness';
import { AuthzError } from '@/lib/auth/errors';
import { ensureSessionReady } from '@/lib/auth/provision';

// Re-exported so existing `import { AuthzError } from '@/lib/auth/authorize'`
// callers keep working. The class lives in lib/auth/errors.ts (pure) so
// non-Next consumers — the proof runner — can import it without dragging in
// next/navigation.
export { AuthzError };

/** The authenticated portal user, or null. */
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await userByEmail(session.user.email);
  if (!user) return null;

  // ── Session freshness ──────────────────────────────────────────────
  // A JWT is self-contained, so a password change cannot "revoke" it by
  // deleting a row — the cookie an attacker copied keeps working for
  // `maxAge` (7 days). The token carries the `password_changed_at` it was
  // minted with (see auth.ts); comparing it against the live row is what
  // makes a password change actually log other devices out.
  //
  // A token with NO stamp predates migration 0006 and is treated as stale:
  // one forced re-login on deploy, rather than leaving an unbounded set of
  // tokens that no credential change can ever invalidate.
  if (!sessionIsFresh(session.user.passwordChangedAt, user.passwordChangedAt)) {
    log.warn('auth: session predates the last password change — rejected', {
      identity: user.email,
    });
    return null;
  }

  return user;
}

// Re-exported so existing callers keep importing it from here.
export { sessionIsFresh };


/**
 * Look up the domain mirror row for an email.
 *
 * The session carries the AUTH identity (auth_users); authorization reads
 * the `users` mirror. This is the single bridge between them, kept here
 * so no other module has to write its own join.
 */
export async function userByEmail(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  return user ?? null;
}

/**
 * Every org the caller belongs to, with their role. This is the org
 * switcher's data source — and the only list of orgs the portal will ever
 * consider "yours".
 */
export const listMemberships = cache(async () => {
  const user = await currentUser();
  if (!user) return [];

  // Every authenticated account owns a personal org from its first product
  // request (lib/auth/provision.ts). Provisioning is triggered HERE, at the
  // single choke point every membership read already funnels through
  // (/api/orgs directly; /api/subscription, /api/keys, /api/usage and the
  // billing pages via requireActiveOrg). Without it a brand-new account had
  // no membership, so its OWN dashboard answered 403 "No organization" and
  // rendered empty until it manually created something — which nothing in
  // the signup flow asks it to do. Cached per request, so this and the
  // shell layout's call collapse to one run.
  await ensureSessionReady(user.id);

  return db
    .select({
      orgId:     organizations.id,
      orgSlug:   organizations.slug,
      orgName:   organizations.name,
      orgStatus: organizations.status,
      role:      organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, user.id));
});

/**
 * Resolve an orgId that the SESSION proves the caller may act on.
 *
 * Pass the orgId the request is asking about; this function returns it
 * only if membership exists. Returning null (or throwing) is the entire
 * point: a guessed UUID must be indistinguishable from a nonexistent one.
 */
export async function requireOrgMembership(orgId: string): Promise<{
  org: typeof organizations.$inferSelect;
  userId: string;
  role: OrgRole;
}> {
  const user = await currentUser();
  if (!user) {
    throw new AuthzError('Not signed in', 'unauthorized', 401);
  }

  const row = await db
    .select({ org: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, user.id),
      ),
    )
    .limit(1);

  const found = row[0];
  if (!found) {
    // 404, not 403: a non-member should not learn that the org exists.
    throw new AuthzError('Not found', 'not_found', 404);
  }
  if (found.org.status === 'deleted') {
    throw new AuthzError('Not found', 'not_found', 404);
  }

  return { org: found.org, userId: user.id, role: found.role };
}

// ───────────────────────────────────────────────────────────────────────
//  Role gates — PLATFORM.md §8.5 / IMPLEMENTATION.md §1.2
// ───────────────────────────────────────────────────────────────────────

const ORG_RANK: Record<OrgRole, number> = {
  viewer: 0,
  billing: 1,
  developer: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: OrgRole, required: OrgRole): boolean {
  return ORG_RANK[role] >= ORG_RANK[required];
}

// The rank table itself lives in `staff-roles.ts` so `lib/admin/staff.ts`
// can validate a role without importing this module (which would be
// circular). Imported AND re-exported: the gates below use the names in
// their own bodies, and every existing caller — pages, nav, the admin
// routes — already imports them from `authorize`.
import {
  staffAtLeast,
  type StaffRole,
} from '@/lib/auth/staff-roles';

export {
  STAFF_ROLES,
  STAFF_ROLE_SUMMARY,
  isStaffRole,
  staffAtLeast,
  type StaffRole,
} from '@/lib/auth/staff-roles';

/**
 * Is this staff session still fresh?
 *
 * `requireStaff()` resolves the ROLE from `staff_users` alone, never from
 * the customer tables — a staff account must not become a customer by
 * virtue of a shared email. Freshness is the one thing that must cross
 * over: the token's `password_changed_at` was minted from
 * `users.password_changed_at` at sign-in (auth.ts), so a password change
 * has to invalidate a stolen staff cookie exactly as it invalidates a
 * customer's. Only the stamp is read from `users`, never a role or an org.
 *
 * A staff identity with no `users` row has no stamp to compare, and
 * `sessionIsFresh` accepts that case — there is nothing to invalidate.
 */
async function staffSessionIsFresh(
  email: string,
  tokenStamp: string | null | undefined,
): Promise<boolean> {
  const mirror = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { passwordChangedAt: true },
  });
  return sessionIsFresh(tokenStamp, mirror?.passwordChangedAt);
}

/**
 * Staff access, resolved from `staff_users` — never from an org_role.
 *
 * A staff account must never be able to act as a customer. The two lookups
 * are deliberately independent: `currentUser()` reads `users`, this reads
 * `staff_users`, and nothing bridges them.
 */
export async function requireStaff(required: StaffRole = 'read_only') {
  const session = await auth();
  if (!session?.user?.email) {
    throw new AuthzError('Not signed in', 'unauthorized', 401);
  }

  // Freshness BEFORE the role lookup. A cookie minted before the account's
  // last password change is an unauthenticated cookie, so this is 401
  // (re-authenticate), not 403 (you are not staff).
  if (!(await staffSessionIsFresh(session.user.email, session.user.passwordChangedAt))) {
    log.warn('auth: staff session predates the last password change — rejected', {
      identity: session.user.email,
    });
    throw new AuthzError('Session expired', 'unauthorized', 401);
  }

  const staff = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, session.user.email),
  });
  if (!staff) {
    // Deliberately 403 rather than 404 — staff routes already announce
    // their existence to authenticated users.
    throw new AuthzError('Staff access required', 'forbidden', 403);
  }

  // Revocation (0015). Checked AFTER the row lookup so a revoked operator
  // gets 403, not the 401 that means "log in again" — their password is
  // fine, their ACCESS was withdrawn, and telling them to re-authenticate
  // would loop them straight back to the same refusal.
  //
  // NULL means active, so every row written before 0015 keeps working.
  if (staff.revokedAt) {
    log.warn('auth: revoked staff account attempted access', {
      identity: session.user.email,
      revokedAt: staff.revokedAt.toISOString(),
    });
    throw new AuthzError('Staff access has been revoked', 'forbidden', 403);
  }

  const role = staff.role as StaffRole;
  if (!staffAtLeast(role, required)) {
    throw new AuthzError('Insufficient staff role', 'forbidden', 403);
  }
  return staff;
}

/**
 * The caller's staff role, or null.
 *
 * `requireStaff()` throws, which is right for a route and wrong for a
 * layout or a page that must render a decision instead of an error. This
 * is the same lookup, non-throwing, so a nav can hide `/admin/d17` from
 * customers instead of offering a link that answers 403.
 *
 * Still resolved from `staff_users` alone. It never falls back to an org
 * role, because a staff account must not be able to act as a customer.
 */
export async function currentStaffRole(): Promise<StaffRole | null> {
  const session = await auth();
  if (!session?.user?.email) return null;

  // Same freshness rule as requireStaff(): a stale cookie grants no role,
  // so the admin nav simply does not appear rather than appearing and then
  // answering 401 on the first action.
  if (!(await staffSessionIsFresh(session.user.email, session.user.passwordChangedAt))) {
    log.warn('auth: staff session predates the last password change — rejected', {
      identity: session.user.email,
    });
    return null;
  }

  const staff = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, session.user.email),
  });
  // A revoked operator is not staff for navigation purposes either: the
  // nav must disappear rather than offer links that answer 403.
  if (!staff || staff.revokedAt) return null;
  return staff.role as StaffRole;
}

// ───────────────────────────────────────────────────────────────────────
//  Page-level helpers — these redirect instead of throwing, because a page
//  has no useful way to render an error object.
// ───────────────────────────────────────────────────────────────────────

export async function requirePageOrg(orgId: string) {
  try {
    return await requireOrgMembership(orgId);
  } catch (e) {
    if (e instanceof AuthzError && e.code === 'unauthorized') {
      redirect('/sign-in');
    }
    // A non-member gets the same treatment as a nonexistent org: bounce
    // to the org switcher rather than rendering an empty page.
    redirect('/dashboard');
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Active org — the org the caller is acting on
// ───────────────────────────────────────────────────────────────────────

/**
 * The caller's ACTIVE organization.
 *
 * The session carries identity, never an org (auth.ts, `session`
 * callback), and the request must never supply one: a route that reads
 * `params.orgId` or `body.orgId` is the IDOR this module exists to
 * prevent. So the org is derived from the caller's own memberships, then
 * membership is proved again through requireOrgMembership().
 *
 * `memberships[0]` is correct while every member belongs to exactly one
 * org, which is what provisioning creates (ensurePersonalOrg) and what
 * the product currently offers. When the org switcher (C-01) lands, this
 * becomes "the org named by a validated, signed selection" — the signature
 * stays the same, so callers do not change.
 */
export async function requireActiveOrg(): Promise<{
  orgId: string;
  org: typeof organizations.$inferSelect;
  userId: string;
  role: OrgRole;
}> {
  // Distinguish "not signed in" from "signed in, but no organization".
  //
  // Without this check, an anonymous request falls through to the empty
  // membership list below and is answered 403 "No organization" — wrong
  // on both counts. A client cannot tell that it should re-authenticate,
  // and the message describes the server's data model rather than the
  // requester's problem.
  const user = await currentUser();
  if (!user) {
    throw new AuthzError('Not signed in', 'unauthorized', 401);
  }

  const memberships = await listMemberships();
  const first = memberships[0];
  if (!first) {
    throw new AuthzError('No organization', 'forbidden', 403);
  }
  const resolved = await requireOrgMembership(first.orgId);
  return { orgId: resolved.org.id, org: resolved.org, userId: resolved.userId, role: resolved.role };
}

/** requireActiveOrg() for pages: redirects instead of throwing. */
export async function requirePageActiveOrg() {
  try {
    return await requireActiveOrg();
  } catch (e) {
    if (e instanceof AuthzError && e.code === 'unauthorized') {
      redirect('/sign-in');
    }
    redirect('/dashboard');
  }
}
