/**
 * Seed the ZAINO-LAUNCH-3M trial code and hidden trial plan.
 *
 * Idempotent — safe to run multiple times. Migrations 0017 and 0045 already
 * seed these rows; this script exists for re-seeding on environments where
 * migrations ran before those files were added, or for creating the launch
 * code without a new migration.
 *
 * 0045 retired the per-campaign codes (ZAINO-FREE-OCT26, ZAINO-FREE-NOV26).
 * This script seeds the launch code and retires the codes the product no
 * longer offers. 0047 added a second live code for outreach, so "retire
 * everything except the launch code" is no longer the current set — the
 * keep-list is explicit, or a re-seed silently kills a code that is in
 * circulation.
 *
 * Usage:  cd portal && npx tsx scripts/seed-trial-code.ts
 */
import './env.mjs';

import { sql, eq, and, notInArray } from 'drizzle-orm';
import { db, sql as pg } from '@/db';
import { trialCodes, plans } from '@/db/schema';

async function main() {
  // 1. Ensure the hidden trial plan exists
  const [existingPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.code, 'trial'))
    .limit(1);

  if (!existingPlan) {
    await db.insert(plans).values({
      code: 'trial',
      name: 'Free Trial',
      description: '3-day free trial, unlimited tokens on smart, frontier and fable.',
      public: false,
      sortOrder: -1,
      priceCents: 0,
      interval: 'month',
      // Trial enforcement is the per-alias token budget below. LiteLLM still
      // requires max_budget > 0, so keep a generous placeholder cap.
      includedSpendCents: 500,
      overageMarkupBps: 0,
      hardCapCents: 500,
      rpmLimit: 10,
      tpmLimit: 50000,
      maxConcurrentRequests: 2,
      maxKeys: 15,
      // The only spend brake once token_limits is empty (0049).
      dailyTokenCap: 15_000_000,
      rateMultiplierBps: 10000,
      models: ['smart', 'frontier', 'fable'],
      trialDays: 3,
      // 0049: no pool at all. The empty map is how one UNLIMITED allowance is
      // expressed — tokenPoolFromLimits() returns null for it. The daily cap
      // set above is then the only spend brake, so it must stay non-zero.
      tokenLimits: {},
      features: {},
    });
    console.log('✓ Created trial plan');
  } else {
    console.log('✓ Trial plan already exists');
  }

  // 0039: ONE shared pool per plan, stated once on a single key — the values
  // SUM to the allowance and the keys are not caps. These must match
  // 0039_pool_totals.sql, or a freshly seeded DB gets different budgets from
  // a migrated one.
  // `trial` is NOT in this list. Its pool is now the EMPTY map (0049 =
  // unlimited), and this clause keys off a missing entry — re-running it
  // would have written 4M back onto an unlimited plan without a word.
  await db.execute(sql`
    UPDATE plans SET token_limits = '{"fast": 50000000}'::jsonb
     WHERE code = 'starter' AND COALESCE((token_limits ->> 'fast')::bigint, 0) = 0;
    UPDATE plans SET token_limits = '{"smart": 50000000}'::jsonb
     WHERE code = 'pro' AND COALESCE((token_limits ->> 'smart')::bigint, 0) = 0;
  `);
  console.log('✓ Token pools backfilled (starter/pro)');

  // 2. Ensure the ONE launch code exists (migration 0045)
  const LAUNCH_CODE = 'ZAINO-LAUNCH-3M';
  const [existingCode] = await db
    .select({ id: trialCodes.id })
    .from(trialCodes)
    .where(eq(trialCodes.code, LAUNCH_CODE))
    .limit(1);

  if (!existingCode) {
    await db.insert(trialCodes).values({
      code: LAUNCH_CODE,
      createdBy: 'system',
      maxRedemptions: 0, // unlimited
      models: ['smart', 'frontier', 'fable'],
      // 0049: unlimited, like the plan it redeems onto.
      tokenLimits: {},
      trialDays: 3,
      // The CAMPAIGN is three months; an individual trial is still 3 days.
      // redeemTrialCode takes min(now + trial_days, expires_at), so a late
      // redemption gets only the days the campaign has left.
      validFrom: new Date('2026-10-20T00:00:00+01:00'),
      validUntil: new Date('2027-01-20T23:59:59+01:00'),
      expiresAt: new Date('2027-01-20T23:59:59+01:00'),
      active: true,
    });
    console.log(`✓ Created ${LAUNCH_CODE} trial code`);
  } else {
    console.log(`✓ ${LAUNCH_CODE} already exists`);
  }

  // Retire any campaign code the product no longer offers. Deactivate rather
  // than delete: trial_redemptions cascades on this table's rows.
  //
  // Keeping ZAINO-PARTNER-3D (0047) is the point of the explicit list. This
  // clause used to read `code <> ZAINO-LAUNCH-3M`, which was correct while the
  // launch code was the only live one; re-seeding after the partner code went
  // out would have deactivated it silently — the migration's guard does not
  // watch `active`, so nothing would have caught it.
  const LIVE_CODES = [LAUNCH_CODE, 'ZAINO-PARTNER-3D'];
  const retired = await db
    .update(trialCodes)
    .set({ active: false })
    .where(and(notInArray(trialCodes.code, LIVE_CODES), eq(trialCodes.active, true)))
    .returning({ code: trialCodes.code });
  if (retired.length > 0) {
    console.log(`✓ Retired ${retired.map((r) => r.code).join(', ')}`);
  }

  await pg.end();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  await pg.end();
  process.exit(1);
});
