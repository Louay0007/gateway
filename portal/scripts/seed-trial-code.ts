/**
 * Seed the ZAINO-LAUNCH-3M trial code and hidden trial plan.
 *
 * Idempotent — safe to run multiple times. Migrations 0017 and 0045 already
 * seed these rows; this script exists for re-seeding on environments where
 * migrations ran before those files were added, or for creating the launch
 * code without a new migration.
 *
 * 0045 retired the per-campaign codes (ZAINO-FREE-OCT26, ZAINO-FREE-NOV26).
 * This script seeds the launch code only and retires anything else, so a
 * re-seed cannot resurrect a code the product no longer offers.
 *
 * Usage:  cd portal && npx tsx scripts/seed-trial-code.ts
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql, eq } from 'drizzle-orm';
import { trialCodes, plans } from '../db/schema';

const dsn = process.env.DATABASE_URL;
if (!dsn) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dsn });
const db = drizzle(pool);

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
      description: '3-day free trial, 1M shared tokens on fast and smart.',
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
      maxKeys: 1,
      rateMultiplierBps: 10000,
      models: ['fast', 'smart'],
      trialDays: 3,
      // 0039: ONE shared 1M pool over the 3-day window (~0.20 DT per
      // redemption). A free trial must not equal a paid Starter month.
      tokenLimits: { fast: 1_000_000 },
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
  await db.execute(sql`
    UPDATE plans SET token_limits = '{"fast": 50000000}'::jsonb
     WHERE code = 'starter' AND COALESCE((token_limits ->> 'fast')::bigint, 0) = 0;
    UPDATE plans SET token_limits = '{"smart": 50000000}'::jsonb
     WHERE code = 'pro' AND COALESCE((token_limits ->> 'smart')::bigint, 0) = 0;
    UPDATE plans SET token_limits = '{"fast": 1000000}'::jsonb
     WHERE code = 'trial' AND COALESCE((token_limits ->> 'fast')::bigint, 0) = 0;
  `);
  console.log('✓ Token pools backfilled (starter/pro/trial)');

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
      models: ['fast', 'smart'],
      // 0039: 1M shared pooled tokens — the only trial quota.
      tokenLimits: { fast: 1_000_000 },
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

  // Retire any other campaign code, so exactly one is redeemable. Deactivate
  // rather than delete: trial_redemptions cascades on this table's rows.
  const retired = await db
    .update(trialCodes)
    .set({ active: false })
    .where(sql`code <> ${LAUNCH_CODE} AND active IS TRUE`)
    .returning({ code: trialCodes.code });
  if (retired.length > 0) {
    console.log(`✓ Retired ${retired.map((r) => r.code).join(', ')}`);
  }

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});