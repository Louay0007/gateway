/**
 * First-login provisioning — IMPLEMENTATION.md §7 Phase 1, MVP shape.
 *
 * The sequence:
 *
 *   1. Mirror user      (already done by the credentials provider)
 *   2. Create org       (local, transactional)
 *   3. Owner membership  (same transaction — an org with no owner is
 *                        unreachable and un-deletable)
 *   4. LiteLLM team     (remote; may fail)
 *
 * And then it STOPS. There is no step 5 and no step 6: this is an
 * individual-account MVP with no free tier, so a new account owns an org
 * and a team but no subscription, no entitlement, and therefore no
 * ability to spend or mint keys. The dashboard reads that absence as
 * "choose a plan" (lib/billing/planState), and the first subscription
 * activation is what pushes the real limits to the gateway.
 *
 * Step 4 can still fail without losing the org: a user whose team
 * creation failed has a valid org and a dashboard; they are simply at
 * the paywall with no gateway linkage, which is recoverable by re-running
 * provisioning (the entitlement reconcile re-pushes once they subscribe).
 */

import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import { organizations, organizationMembers, users } from '@/db/schema';
import { createTeam } from '@/lib/litellm/client';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import { slugCandidates, slugify } from '@/lib/org/slug';
import { log } from '@/lib/log';

// Re-exported so callers importing from provision keep working.
export { slugify, slugCandidates } from '@/lib/org/slug';

/**
 * Models a new org's team may serve BEFORE it subscribes.
 *
 * Every alias the gateway serves, deliberately a SUPERSET of any plan
 * allowlist (starter is fast+smart, pro is all three). LiteLLM resolves a
 * key's effective access as the INTERSECTION of the key's models and its
 * team's models, so a team created with a narrower list silently caps
 * every key beneath it — the key reports {fast, smart} and the team says
 * {fast}, and the request 403s with a message that blames the credential
 * rather than the team. (HANDOFF.md §5.26.)
 *
 * A pre-activation team is budgeted at CUT_BUDGET = 0, so this wider list
 * grants nothing on its own: nothing can be spent, and no key is minted
 * until a subscription exists. It exists so activation never has to widen
 * a team that was born narrow. `syncOrganizationEntitlements` pushes the
 * real allowlist and `updateTeamModels` narrows it back down.
 */
const DEFAULT_MODELS = ['fast', 'smart', 'frontier'];

/**
 * Derive a unique, URL-safe slug from a display name.
 *
 * Collision handling appends a short random suffix rather than failing:
 * two people named "Alex Kim" must not collide on the first login.
 *
 * Exported because the org-settings route renames the same entity and
 * must resolve collisions the same way — two implementations of "unique
 * slug" is two behaviours to keep in sync.
 */
export async function uniqueSlug(name: string): Promise<string> {
  for (const candidate of slugCandidates(name)) {
    const clash = await db.query.organizations.findFirst({
      where: eq(organizations.slug, candidate),
    });
    if (!clash) return candidate;
  }
  // Every candidate collided (astronomically unlikely). Use a unique one.
  return `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Request-scoped provisioning.
 *
 * The subtle part: in the App Router a layout and its page render
 * CONCURRENTLY, not in sequence. Provisioning in the layout alone means
 * the page can call `listMemberships()` before the provisioning
 * transaction commits, and a brand-new user gets bounced to /sign-in on
 * their very first dashboard load — a bug that disappears on the second
 * request and is invisible in any test that logs in first.
 *
 * `cache()` scopes this to one execution per request, so the layout and
 * every page under it share a single promise: whichever component reaches
 * it first performs the work, and every other component awaits the same
 * result. Pages must call this BEFORE reading memberships.
 */
export const ensureSessionReady = cache(async (userId: string) => {
  return ensurePersonalOrg(userId);
});

/**
 * Ensure a user has a personal organization, subscription, and a team in
 * LiteLLM. Safe to call on every authenticated request — it is a no-op
 * once the user has an org.
 *
 * Returns the org and whether provisioning was created this call.
 */
export async function ensurePersonalOrg(userId: string): Promise<{
  organizationId: string;
  created: boolean;
  liteLLMTeamError?: string;
}> {
  // The common path: already a member somewhere.
  const existing = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });
  if (existing) {
    return { organizationId: existing.organizationId, created: false };
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error(`provision: user ${userId} not found`);

  const displayName = user.name?.trim() || user.email.split('@')[0] || 'My Org';
  const slug = await uniqueSlug(displayName);

  // 2–3. Org + owner membership together. Without the membership the org
  // is orphaned and requireOrgMembership would 404 for its creator.
  const created = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: displayName, slug, keyOwnership: 'platform' })
      .returning();
    if (!org) throw new Error('provision: failed to create organization');

    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId,
      role: 'owner',
    });
    return org;
  });

  // 4. LiteLLM team. Non-fatal — an org at the paywall has no access to
  //    lose. The team starts at CUT_BUDGET so that even a key minted by
  //    mistake (no code path mints one pre-subscription, but the gateway
  //    does not know that) cannot spend; the first subscription
  //    activation replaces it with the plan's real budget.
  let teamError: string | undefined;
  try {
    const team = await createTeam({
      teamAlias: slug,
      maxBudgetUsd: CUT_BUDGET,
      budgetDuration: '30d',
      models: DEFAULT_MODELS,
    });
    await db
      .update(organizations)
      .set({ litellmTeamId: team.team_id, updatedAt: new Date() })
      .where(eq(organizations.id, created.id));
  } catch (e) {
    teamError = String(e);
    log.error('provision: LiteLLM team creation failed', { organizationId: created.id, error: teamError });
  }

  // No subscription, no entitlement, no sync: the account sits at the
  // paywall until lib/billing activates a plan, which owns that push.

  return { organizationId: created.id, created: true, liteLLMTeamError: teamError };
}
