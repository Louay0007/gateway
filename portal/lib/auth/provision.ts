/**
 * First-login provisioning — IMPLEMENTATION.md §7 Phase 1.
 *
 * Acceptance criterion: "New signup lands on /dashboard with $0 usage,
 * team exists in LiteLLM."
 *
 * The sequence matters, and the ordering is the point:
 *
 *   1. Mirror user      (already done by the credentials provider)
 *   2. Create org       (local, transactional)
 *   3. Owner membership  (same transaction — an org with no owner is
 *                        unreachable and un-deletable)
 *   4. LiteLLM team     (remote; may fail)
 *   5. Free subscription (local)
 *   6. Entitlement sync (pushes the free plan to the gateway)
 *
 * Step 4 can fail without losing the org: we commit steps 2–3 first, then
 * attach the team, then create the subscription and sync. A user whose
 * team creation failed still has a valid org and a dashboard; they are
 * simply at $0 with no gateway access, which is the correct state for a
 * free account anyway.
 */

import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import {
  organizations,
  organizationMembers,
  plans,
  subscriptions,
  users,
} from '@/db/schema';
import { createTeam } from '@/lib/litellm/client';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { slugCandidates, slugify } from '@/lib/org/slug';
import { log } from '@/lib/log';

// Re-exported so callers importing from provision keep working.
export { slugify, slugCandidates } from '@/lib/org/slug';

/** Plans exposed to a brand-new org. Model C/B: free until they pay. */
const DEFAULT_PLAN = 'free';

/**
 * Derive a unique, URL-safe slug from a display name.
 *
 * Collision handling appends a short random suffix rather than failing:
 * two people named "Alex Kim" must not collide on the first login.
 */
async function uniqueSlug(name: string): Promise<string> {
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

  // 4. LiteLLM team. Non-fatal — a free org has no access to lose.
  let teamError: string | undefined;
  try {
    const freePlan = await db.query.plans.findFirst({
      where: eq(plans.code, DEFAULT_PLAN),
    });
    const models = freePlan?.models ?? ['fast'];
    const team = await createTeam({
      teamAlias: slug,
      maxBudgetUsd: 0.000001,   // free tier must not be able to spend
      budgetDuration: '30d',
      models,
    });
    await db
      .update(organizations)
      .set({ litellmTeamId: team.team_id, updatedAt: new Date() })
      .where(eq(organizations.id, created.id));
  } catch (e) {
    teamError = String(e);
    log.error('provision: LiteLLM team creation failed', { organizationId: created.id, error: teamError });
  }

  // 5. Free subscription.
  const freePlan = await db.query.plans.findFirst({ where: eq(plans.code, DEFAULT_PLAN) });
  if (!freePlan) {
    log.error('provision: free plan missing from catalog', { organizationId: created.id });
    return { organizationId: created.id, created: true, liteLLMTeamError: teamError };
  }

  await tx_insertFreeSubscription(created.id, freePlan.id);

  // 6. Push the entitlement so the dashboard and the gateway agree from
  //     the very first load.
  const sync = await syncOrganizationEntitlements(created.id, 'signup-provision');
  if (!sync.ok) {
    log.error('provision: entitlement sync failed', { organizationId: created.id, error: sync.error });
  }

  return { organizationId: created.id, created: true, liteLLMTeamError: teamError };
}

async function tx_insertFreeSubscription(orgId: string, planId: string): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  // The free plan has trial_days = 0, so there is no trial. Set
  // trial_end to the subscription start so `expire_trials` has an already
  // expired row rather than a NULL it must special-case.
  const trialEnd = now;

  await db
    .insert(subscriptions)
    .values({
      organizationId: orgId,
      planId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEnd,
    })
    // Target-free ON CONFLICT, deliberately.
    //
    // `subscriptions_one_live_idx` is a PARTIAL unique index on
    // organization_id WHERE status IN ('trialing','active','past_due',
    // 'paused'). An explicit conflict target cannot reference a partial
    // index unless the index predicate is repeated in the WHERE clause of
    // the insert, and Postgres rejects a target it cannot match with
    // 42P10. A bare `DO NOTHING` catches every unique violation, including
    // the partial one, which is exactly the idempotence we want.
    .onConflictDoNothing();
}