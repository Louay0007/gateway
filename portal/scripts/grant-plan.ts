/**
 * Put a local organization on a plan, so the models and the chat work.
 *
 *   make plan                 # starter, on this machine's customer account
 *   make plan PLAN=pro        # a different tier
 *   make plan EMAIL=...       # a different person
 *
 * WHY THIS EXISTS. Chat is gated on a live subscription: `/api/chat` asks
 * `getAllowedModels()` what the org may use, gets an empty list, and
 * answers 402 "Choose a plan to start chatting." With a fresh database
 * that is EVERY account, so a local stack looks broken when it is
 * behaving exactly as designed. The two paths that normally grant access
 * are a D17 payment and the ZAINO-FREE-OCT26 trial — and the trial code
 * expired on 31 Oct 2026, so redeeming it now correctly fails.
 *
 * This calls `grantPlan()`, the SAME function behind the console's "grant
 * plan" button (app/admin/orgs). It is not a hand-written INSERT, because
 * writing `subscriptions` alone changes what the dashboard says and
 * nothing about what the gateway allows — the grant ends in
 * `syncOrganizationEntitlements`, and an "upgraded" org that still gets
 * 403s is worse than no button at all.
 *
 * It grants to the org that owns EMAIL, the same account `make accounts`
 * creates, so `make plan && make accounts` is the whole local setup.
 *
 * NOT A PRODUCTION TOOL. It needs no staff session, which is the one thing
 * grantPlan() normally requires — that check lives in the admin ACTION,
 * not the service. Usable only from inside the job container against the
 * database this compose file owns.
 */
import './env.mjs';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { organizations, organizationMembers, plans, staffUsers, users } from '@/db/schema';
import { grantPlan } from '@/lib/admin/subscriptions';

const EMAIL = (process.env.PLAN_EMAIL ?? 'customer@example.test').trim().toLowerCase();
const PLAN = (process.env.PLAN_CODE ?? 'starter').trim().toLowerCase();

/** The system actor for the audit row. */
const SYSTEM_STAFF = 'local-plan-grant';

async function main() {
  // ── 1. The person. Email, not id: the id differs between auth_users and
  //      users and nobody should have to know which one to paste.
  const user = await db.query.users.findFirst({
    where: eq(users.email, EMAIL),
    columns: { id: true, name: true },
  });
  if (!user) {
    console.error(`No account for ${EMAIL}.`);
    console.error('Create it first:  make accounts');
    process.exit(1);
  }

  // ── 2. Their org. Memberships, not a slug guess: the org may have been
  //      renamed, and provision() picks a unique slug per environment.
  const membership = await db
    .select({ orgId: organizationMembers.organizationId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, user.id))
    .limit(1);

  const orgId = membership[0]?.orgId;
  if (!orgId) {
    console.error(`${EMAIL} has no organization. Sign in once at /chat, then re-run.`);
    process.exit(1);
  }

  // ── 3. A staff actor for the audit row. grantPlan() records who did it,
  //      and audit_log.staff_id is NOT NULL. Reusing the first existing
  //      staff row keeps the history honest if a real operator exists;
  //      otherwise this creates one namespaced local pseudo-actor.
  const existing = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(and(eq(staffUsers.email, SYSTEM_STAFF), eq(staffUsers.role, 'admin')))
    .limit(1);

  let staffId = existing[0]?.id;
  if (!staffId) {
    const [created] = await db
      .insert(staffUsers)
      .values({ email: SYSTEM_STAFF, name: 'Local Plan Grant', role: 'admin' })
      .onConflictDoUpdate({
        target: staffUsers.email,
        set: { revokedAt: null },
      })
      .returning({ id: staffUsers.id });
    staffId = created?.id;
  }
  if (!staffId) {
    console.error('Could not resolve a staff actor for the audit row.');
    process.exit(1);
  }

  // ── 4. Grant. Idempotent by design: the same call twice leaves one
  //      period, not two (see periodFor in lib/admin/grant-schema.ts).
  const result = await grantPlan(staffId, orgId, PLAN);

  if (!result.ok) {
    console.error(`Grant failed: ${result.error}`);
    if (result.error === 'plan_not_found') {
      const known = await db.select({ code: plans.code }).from(plans);
      console.error('Known plans:', known.map((p) => p.code).join(', '));
    }
    process.exit(1);
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { name: true, slug: true },
  });

  console.log('');
  console.log(`  ✓ ${org?.name ?? orgId} is on ${PLAN}`);
  console.log(`    for ${EMAIL}`);
  // syncOk is reported, never fatal: the subscription is committed and a
  // gateway hiccup must not read as "the grant did not happen".
  console.log(
    result.syncOk
      ? '    entitlement synced to the gateway — models are live'
      : '    entitlement sync FAILED — the plan is active but the gateway still denies models. Check: make health',
  );
  console.log('');
  console.log('  Reload /chat and the model picker should list the plan tiers.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`FATAL: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  },
);
