/**
 * Seed the ZAINO-FREE-OCT26 trial code and hidden trial plan.
 *
 * Idempotent — safe to run multiple times. The migration 0017 already
 * seeds these rows; this script exists for re-seeding on environments
 * where migrations ran before 0017 was added, or for creating additional
 * codes without a new migration.
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
      description: '3-day trial with 300 requests on Sonnet 5 and Opus 5.5.',
      public: false,
      sortOrder: -1,
      priceCents: 0,
      interval: 'month',
      // Trial uses prompt-based limits (300 fast + 300 smart), not dollar caps.
      // But LiteLLM enforces max_budget as a hard ceiling regardless — a $0
      // budget means CUT_BUDGET ($0.000001) which exhausts after one prompt.
      // Set a generous dollar cap that won't be hit before the prompt limit
      // kicks in (~$5 covers 300 prompts on Sonnet/Opus comfortably).
      includedSpendCents: 500,
      overageMarkupBps: 0,
      hardCapCents: 500,
      rpmLimit: 10,
      tpmLimit: 50000,
      maxConcurrentRequests: 2,
      maxKeys: 1,
      maxSeats: 1,
      rateMultiplierBps: 10000,
      models: ['fast', 'smart'],
      trialDays: 3,
      promptLimits: { fast: 300, smart: 300 },
      features: {},
    });
    console.log('✓ Created trial plan');
  } else {
    console.log('✓ Trial plan already exists');
  }

  // 2. Ensure the ZAINO-FREE-OCT26 code exists
  const [existingCode] = await db
    .select({ id: trialCodes.id })
    .from(trialCodes)
    .where(eq(trialCodes.code, 'ZAINO-FREE-OCT26'))
    .limit(1);

  if (!existingCode) {
    await db.insert(trialCodes).values({
      code: 'ZAINO-FREE-OCT26',
      createdBy: 'system',
      maxRedemptions: 0, // unlimited
      models: ['fast', 'smart'],
      promptLimits: { fast: 300, smart: 300 },
      trialDays: 3,
      validFrom: new Date('2026-10-20T00:00:00+01:00'),
      // Campaign extended to end 1 Nov 00:00 Tunis (migration 0021).
      validUntil: new Date('2026-10-31T23:59:59+01:00'),
      expiresAt: new Date('2026-10-31T23:59:59+01:00'),
      active: true,
    });
    console.log('✓ Created ZAINO-FREE-OCT26 trial code');
  } else {
    console.log('✓ ZAINO-FREE-OCT26 already exists');
  }

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});