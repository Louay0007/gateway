/**
 * Prove the manual plan grant against a real database.
 *
 *   make verify-grant
 *
 * WHY A SCRIPT AND NOT ONLY A UNIT TEST. `tests/admin-grant-plan.test.ts`
 * covers the period arithmetic, which is pure. Everything below is SQL,
 * and SQL is exactly what a typechecker cannot see:
 *
 *   - the FOR UPDATE OF s clause is valid SQL in a JOIN;
 *   - subscriptions_one_live_idx is not violated by the insert path;
 *   - the second grant MUTATES the row instead of adding a live one;
 *   - the window is written in UTC and read back identical;
 *   - the audit row lands with before/after.
 *
 * The orgs created here have NO litellmTeamId, so syncOrganizationEntitlements
 * short-circuits before any LiteLLM HTTP call: no gateway required, and the
 * DB half of the sync (entitlements upsert) still runs for real. That is why
 * this is safe to run against a live stack, like verify-d17: it spends
 * nothing and touches only rows it created and then deletes.
 *
 * Everything is namespaced `smoke-grant` and removed on the way out, even
 * on failure, so a crashed run does not poison the next one.
 */
import './env.mjs';

import { sql as pg } from '@/db';
import { db } from '@/db';
import { auditLog, organizations, subscriptions, plans, staffUsers } from '@/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { grantPlan } from '@/lib/admin/subscriptions';
import { periodFor } from '@/lib/admin/grant-schema';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail, null, 2));
  }
}

const TAG = 'smoke-grant';

async function cleanup() {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(like(organizations.slug, `${TAG}%`));
  for (const r of rows) {
    await db.delete(auditLog).where(eq(auditLog.organizationId, r.id));
    // subscriptions cascade from organizations.
    await db.delete(organizations).where(eq(organizations.id, r.id));
  }
  await db.delete(staffUsers).where(like(staffUsers.email, `${TAG}%`));
  // Remove the plans this script made, if any survived.
  await db.delete(plans).where(like(plans.code, `${TAG}%`));
}

async function main() {
  console.log('manual plan grant — live-database smoke test\n');
  await cleanup();

  // ── Fixtures ──────────────────────────────────────────────────────
  const [staff] = await db
    .insert(staffUsers)
    .values({ email: `${TAG}-operator@example.test`, name: 'Smoke Operator', role: 'admin' })
    .returning({ id: staffUsers.id });

  const [proMonth] = await db
    .insert(plans)
    .values({
      code: `${TAG}-pro-month`,
      name: 'Smoke Pro (month)',
      priceCents: 2900,
      interval: 'month',
      includedSpendCents: 2000,
      hardCapCents: 5000,
      rateMultiplierBps: 13000,
      overageMarkupBps: 3000,
      maxKeys: 3,
      models: ['fast'],
      public: true,
    })
    .returning();

  const [proYear] = await db
    .insert(plans)
    .values({
      code: `${TAG}-pro-year`,
      name: 'Smoke Pro (year)',
      priceCents: 29000,
      interval: 'year',
      includedSpendCents: 24000,
      rateMultiplierBps: 12500,
      overageMarkupBps: 2500,
      maxKeys: 5,
      models: ['fast'],
      public: false,
    })
    .returning();

  console.log('fixtures: 1 admin, 1 monthly plan, 1 yearly hidden plan\n');

  // ── 1. Grant to an org with NO subscription row at all ────────────
  console.log('1. grant to an org with no subscription');
  const [bare] = await db
    .insert(organizations)
    .values({ slug: `${TAG}-bare`, name: 'Smoke Bare Org' })
    .returning({ id: organizations.id });

  const before = new Date();
  const r1 = await grantPlan(staff!.id, bare!.id, proMonth!.code);
  const after = new Date();

  check('grant reports ok', r1.ok === true, r1);
  if (r1.ok) {
    const start = new Date(r1.periodStart);
    const end = new Date(r1.periodEnd);
    check('period start is now-ish', start >= before && start <= after, {
      start: start.toISOString(),
    });
    check('period is one month', periodFor('month', start).end.getTime() === end.getTime(), {
      start: start.toISOString(),
      end: end.toISOString(),
    });
    check('sync ran and succeeded', r1.syncOk === true, r1.syncError);
    check("effect is full (not cut) for a healthy active org", r1.effect === "full", r1.effect);
    check('previous plan was null', r1.previousPlanCode === null);
  }

  const bareSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, bare!.id));
  check('exactly ONE subscription row exists', bareSubs.length === 1, bareSubs.length);
  check('row status is active', bareSubs[0]?.status === 'active', bareSubs[0]?.status);
  check('row plan is the granted plan', bareSubs[0]?.planId === proMonth!.id);
  check('cancelAtPeriodEnd cleared', bareSubs[0]?.cancelAtPeriodEnd === false);
  check('trialEnd is null', bareSubs[0]?.trialEnd === null, bareSubs[0]?.trialEnd);
  check('dailyQuota true (0025 model)', bareSubs[0]?.dailyQuota === true);
  check(
    'period written matches what was returned',
    bareSubs[0]?.currentPeriodStart?.toISOString() === (r1.ok ? r1.periodStart : ''),
    {
      db: bareSubs[0]?.currentPeriodStart?.toISOString(),
      returned: r1.ok ? r1.periodStart : null,
    },
  );

  const ent1 = (await pg`
    SELECT status::text AS status, plan_code FROM entitlements
     WHERE organization_id = ${bare!.id}::uuid
  `) as unknown as { status: string; plan_code: string }[];
  check('entitlement row synced to the granted plan', ent1[0]?.status === 'synced' && ent1[0]?.plan_code === proMonth!.code, ent1);

  const audit1 = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, bare!.id), eq(auditLog.action, 'subscription.admin_granted')));
  check('audit row written', audit1.length === 1, audit1.length);
  check('audit actor is the operator', audit1[0]?.actorId === staff!.id);
  check('audit records before = no plan', (audit1[0]?.before as { planCode?: unknown } | null)?.planCode === null);
  check(
    'audit records after = granted plan',
    (audit1[0]?.after as { planCode?: unknown } | null)?.planCode === proMonth!.code,
  );

  // ── 2. Re-grant: must UPDATE in place, never insert a second live row ──
  console.log('\n2. re-grant to a different plan (idempotence / one-live-row)');
  await new Promise((r) => setTimeout(r, 60)); // distinct updated_at

  const r2 = await grantPlan(staff!.id, bare!.id, proYear!.code);
  check('second grant ok', r2.ok === true, r2);
  if (r2.ok) {
    check('previous plan is the monthly one', r2.previousPlanCode === proMonth!.code, r2.previousPlanCode);
    check('previous status was active', r2.previousStatus === 'active', r2.previousStatus);
    check('interval switched to year', r2.interval === 'year', r2.interval);
  }

  const bareSubs2 = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, bare!.id));
  check('STILL exactly one subscription row', bareSubs2.length === 1, bareSubs2.length);
  check('same row id (mutated, not replaced)', bareSubs2[0]?.id === bareSubs[0]?.id);
  check('plan moved to the yearly plan', bareSubs2[0]?.planId === proYear!.id);

  // Re-granting must REPLACE the window, not extend it.
  if (r1.ok && r2.ok) {
    const yearEnd = new Date(r2.periodEnd).getTime();
    const stacked = periodFor('year', new Date(r2.periodStart));
    check('window was replaced, not stacked', yearEnd === stacked.end.getTime(), {
      expected: stacked.end.toISOString(),
      got: new Date(yearEnd).toISOString(),
    });
  }

  // ── 3. Grant over a cancelled row (the lapsed-org case) ────────────
  console.log('\n3. grant to an org whose subscription was cancelled');
  const [lapsed] = await db
    .insert(organizations)
    .values({ slug: `${TAG}-lapsed`, name: 'Smoke Lapsed Org' })
    .returning({ id: organizations.id });
  await db.insert(subscriptions).values({
    organizationId: lapsed!.id,
    planId: proMonth!.id,
    status: 'canceled',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
  });

  const r3 = await grantPlan(staff!.id, lapsed!.id, proMonth!.code);
  check('grant over a cancelled row ok', r3.ok === true, r3);
  const lapsedSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, lapsed!.id));
  check('cancelled row reused, no new row', lapsedSubs.length === 1, lapsedSubs.length);
  check('status revived to active', lapsedSubs[0]?.status === 'active', lapsedSubs[0]?.status);
  check(
    'old period replaced with a fresh one',
    lapsedSubs[0]?.currentPeriodEnd?.getTime()! > new Date('2026-02-01T00:00:00Z').getTime(),
  );

  // ── 4. Refusals ───────────────────────────────────────────────────
  console.log('\n4. refusals leave nothing behind');
  const rBadPlan = await grantPlan(staff!.id, bare!.id, 'no-such-plan-xyz');
  check('unknown plan refused', rBadPlan.ok === false && rBadPlan.error === 'plan_not_found', rBadPlan);

  const rBadOrg = await grantPlan(staff!.id, '00000000-0000-0000-0000-000000000000', proMonth!.code);
  check('unknown org refused', rBadOrg.ok === false && rBadOrg.error === 'not_found', rBadOrg);

  const [deleted] = await db
    .insert(organizations)
    .values({ slug: `${TAG}-deleted`, name: 'Smoke Deleted Org', status: 'deleted' })
    .returning({ id: organizations.id });
  const rDeleted = await grantPlan(staff!.id, deleted!.id, proMonth!.code);
  check('deleted org refused', rDeleted.ok === false && rDeleted.error === 'deleted', rDeleted);
  const deletedSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, deleted!.id));
  check('refused grant created no subscription', deletedSubs.length === 0, deletedSubs.length);

  // A refused grant must not write an audit row claiming success.
  const badAudit = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, deleted!.id), eq(auditLog.action, 'subscription.admin_granted')));
  check('refused grant wrote no audit row', badAudit.length === 0, badAudit.length);

  // ── 5. Grant onto a suspended org ─────────────────────────────────
  // Suspension is account-level, so the SYNC must cut even though the
  // subscription is active. This is the interaction that would otherwise
  // hand limits to an account staff had just frozen.
  console.log('\n5. grant onto a SUSPENDED org still cuts at the gateway');
  const [susp] = await db
    .insert(organizations)
    .values({ slug: `${TAG}-suspended`, name: 'Smoke Suspended Org', status: 'suspended' })
    .returning({ id: organizations.id });
  const rSusp = await grantPlan(staff!.id, susp!.id, proMonth!.code);
  check('grant itself ok', rSusp.ok === true, rSusp);
  if (rSusp.ok) {
    check('sync effect is CUT, not allow', rSusp.effect === 'cut', rSusp.effect);
  }
  const suspSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, susp!.id));
  check('subscription row still written as active', suspSubs[0]?.status === 'active', suspSubs[0]?.status);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  await cleanup();
  console.log('fixtures cleaned up');
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SMOKE CRASHED:', e);
  try {
    await cleanup();
    await pg.end();
  } catch {}
  process.exit(1);
});
