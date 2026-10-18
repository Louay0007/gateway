/**
 * Plan management — the catalog CRUD that did not exist.
 *
 * `plans` had ZERO insert/update/delete in application code: the only
 * writer was `0003_mvp_plans_and_bans.sql` and whatever an operator
 * typed into psql. That made the three levers that define the business
 * — `price_cents`, `rate_multiplier_bps`, `hard_cap_cents` — editable
 * only by hand-editing rows, and only with a migration.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT. HANDOFF.md §5.14:
 *
 *   overage_markup_bps MUST equal rate_multiplier_bps − 10000
 *
 * A Starter at 1.30 (13000) carries 3000. Pro at 1.25 (12500) carries
 * 2500. There is no second multiplier anywhere in the codebase, and
 * `tests/security.test.ts` asserts it. A naive plan editor that exposes
 * both fields independently would let an operator set a multiplier and
 * a markup that disagree — which is a silent money bug, not a
 * validation error: every invoice would be wrong by exactly the
 * difference, and nothing would fail. So `overage_markup_bps` is NOT an
 * editable field here. It is DERIVED, every time, from the multiplier.
 *
 * A SECOND INVARIANT: `rate_multiplier_bps` must stay strictly above
 * 10000. At 10000 the reseller gives the margin away; below it, the
 * operator is paying the provider out of their own pocket on every
 * token. README says it plainly — below ~1.20 you subsidise your
 * heaviest users. This refuses anything under 1.10 so a typo cannot set
 * the whole business's pricing.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { plans } from '@/db/schema';
import { appendAudit } from '@/lib/audit';

/** Below this the business loses money on every token. See file header. */
const MIN_RATE_MULTIPLIER_BPS = 11_000;

export interface PlanAdminRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  public: boolean;
  sortOrder: number;
  priceCents: number;
  interval: string;
  includedSpendCents: number;
  overageMarkupBps: number;
  hardCapCents: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxConcurrentRequests: number | null;
  maxKeys: number;
  rateMultiplierBps: number;
  models: string[];
  trialDays: number;
  promptLimits: Record<string, number>;
  /** Live org count on this plan — deleting one with customers is a trap. */
  subscriberCount: number;
  createdAt: string;
}

export async function listPlansAdmin(): Promise<PlanAdminRow[]> {
  const rows = (await db.execute(sql`
    SELECT p.id::text, p.code, p.name, p.description, p.public, p.sort_order,
           p.price_cents, p.interval::text AS interval,
           p.included_spend_cents, p.overage_markup_bps, p.hard_cap_cents,
           p.rpm_limit, p.tpm_limit, p.max_concurrent_requests, p.max_keys,
           p.rate_multiplier_bps, p.models, p.trial_days, p.prompt_limits,
           p.created_at,
           (SELECT count(*) FROM subscriptions s
             WHERE s.plan_id = p.id AND s.status IN ('active','trialing','past_due','unpaid')
           )::int AS subscriber_count
      FROM plans p
     ORDER BY p.sort_order ASC, p.price_cents ASC
  `)) as unknown as {
    id: string;
    code: string;
    name: string;
    description: string | null;
    public: boolean;
    sort_order: number;
    price_cents: number;
    interval: string;
    included_spend_cents: number;
    overage_markup_bps: number;
    hard_cap_cents: number | null;
    rpm_limit: number | null;
    tpm_limit: number | null;
    max_concurrent_requests: number | null;
    max_keys: number;
    rate_multiplier_bps: number;
    models: string[];
    trial_days: number;
    prompt_limits: Record<string, number>;
    created_at: Date | string;
    subscriber_count: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    public: r.public,
    sortOrder: Number(r.sort_order),
    priceCents: Number(r.price_cents),
    interval: r.interval,
    includedSpendCents: Number(r.included_spend_cents),
    overageMarkupBps: Number(r.overage_markup_bps),
    hardCapCents: r.hard_cap_cents == null ? null : Number(r.hard_cap_cents),
    rpmLimit: r.rpm_limit == null ? null : Number(r.rpm_limit),
    tpmLimit: r.tpm_limit == null ? null : Number(r.tpm_limit),
    maxConcurrentRequests:
      r.max_concurrent_requests == null ? null : Number(r.max_concurrent_requests),
    maxKeys: Number(r.max_keys),
    rateMultiplierBps: Number(r.rate_multiplier_bps),
    models: r.models ?? [],
    trialDays: Number(r.trial_days),
    promptLimits: r.prompt_limits ?? {},
    subscriberCount: Number(r.subscriber_count),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export interface PlanInput {
  code: string;
  name: string;
  description?: string | null;
  public?: boolean;
  sortOrder?: number;
  priceCents: number;
  interval?: 'month' | 'year';
  includedSpendCents?: number;
  hardCapCents?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  maxConcurrentRequests?: number | null;
  maxKeys?: number;
  rateMultiplierBps: number;
  models: string[];
  trialDays?: number;
  promptLimits?: Record<string, number>;
}

export type PlanActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; message: string };

/**
 * Validate the money-bearing fields.
 *
 * Returned as a discriminated result rather than thrown so a route can
 * map each failure to its own `jsonError` code without a try/catch.
 */
function validatePlan(input: PlanInput): { ok: true; value: PlanInput } | { ok: false; message: string } {
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(input.code)) {
    return {
      ok: false,
      message: 'Code must be lowercase letters, digits and dashes (2–32 characters).',
    };
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    return { ok: false, message: 'Price must be a whole number of cents, zero or more.' };
  }
  if (
    !Number.isInteger(input.rateMultiplierBps) ||
    input.rateMultiplierBps < MIN_RATE_MULTIPLIER_BPS ||
    input.rateMultiplierBps > 100_000
  ) {
    return {
      ok: false,
      message: 'Rate multiplier must be between 1.10 and 10.00. Below 1.10 the reseller loses money on every token.',
    };
  }
  if (input.includedSpendCents != null && input.includedSpendCents < 0) {
    return { ok: false, message: 'Included spend cannot be negative.' };
  }
  if (
    input.hardCapCents != null &&
    input.includedSpendCents != null &&
    input.hardCapCents < input.includedSpendCents
  ) {
    return {
      ok: false,
      message: 'Hard cap must be at least the included spend, or customers are cut mid-period.',
    };
  }
  if (input.trialDays != null && (!Number.isInteger(input.trialDays) || input.trialDays < 0)) {
    return { ok: false, message: 'Trial days must be zero or a positive whole number.' };
  }
  if (!Array.isArray(input.models) || input.models.length === 0) {
    return { ok: false, message: 'A plan must grant at least one model.' };
  }
  for (const m of input.models) {
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(m)) {
      return { ok: false, message: `"${m}" is not a valid model alias.` };
    }
  }
  return { ok: true, value: input };
}

export async function createPlan(
  actorId: string,
  input: PlanInput,
): Promise<PlanActionResult> {
  const v = validatePlan(input);
  if (!v.ok) return { ok: false, error: 'validation', message: v.message };

  const clash = await db.execute(sql`
    SELECT 1 FROM plans WHERE code = ${input.code} LIMIT 1
  `);
  if (clash.length) {
    return { ok: false, error: 'conflict', message: `A plan with code "${input.code}" already exists.` };
  }

  const [row] = await db
    .insert(plans)
    .values({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      public: input.public ?? true,
      sortOrder: input.sortOrder ?? 100,
      priceCents: input.priceCents,
      interval: input.interval ?? 'month',
      includedSpendCents: input.includedSpendCents ?? 0,
      // DERIVED, never taken from the caller. See the file header.
      overageMarkupBps: input.rateMultiplierBps - 10_000,
      hardCapCents: input.hardCapCents ?? null,
      rpmLimit: input.rpmLimit ?? null,
      tpmLimit: input.tpmLimit ?? null,
      maxConcurrentRequests: input.maxConcurrentRequests ?? null,
      maxKeys: input.maxKeys ?? 1,
      rateMultiplierBps: input.rateMultiplierBps,
      models: input.models,
      trialDays: input.trialDays ?? 0,
      promptLimits: input.promptLimits ?? {},
    })
    .returning({ id: plans.id });

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'plan.created',
    targetType: 'plan',
    targetId: row?.id ?? null,
    organizationId: null,
    after: { code: input.code, priceCents: input.priceCents, rateMultiplierBps: input.rateMultiplierBps },
  });

  return { ok: true, id: row?.id ?? '' };
}

export async function updatePlan(
  actorId: string,
  planId: string,
  input: PlanInput,
): Promise<PlanActionResult> {
  const before = await db.query.plans.findFirst({ where: sql`${plans.id} = ${planId}::uuid` });
  if (!before) return { ok: false, error: 'not_found', message: 'No such plan.' };

  const v = validatePlan(input);
  if (!v.ok) return { ok: false, error: 'validation', message: v.message };

  if (before.code !== input.code) {
    const clash = await db.execute(sql`
      SELECT 1 FROM plans WHERE code = ${input.code} AND id <> ${planId}::uuid LIMIT 1
    `);
    if (clash.length) {
      return { ok: false, error: 'conflict', message: `Another plan already uses code "${input.code}".` };
    }
  }

  await db
    .update(plans)
    .set({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      public: input.public ?? true,
      sortOrder: input.sortOrder ?? 100,
      priceCents: input.priceCents,
      interval: input.interval ?? 'month',
      includedSpendCents: input.includedSpendCents ?? 0,
      overageMarkupBps: input.rateMultiplierBps - 10_000,
      hardCapCents: input.hardCapCents ?? null,
      rpmLimit: input.rpmLimit ?? null,
      tpmLimit: input.tpmLimit ?? null,
      maxConcurrentRequests: input.maxConcurrentRequests ?? null,
      maxKeys: input.maxKeys ?? 1,
      rateMultiplierBps: input.rateMultiplierBps,
      models: input.models,
      trialDays: input.trialDays ?? 0,
      promptLimits: input.promptLimits ?? {},
      updatedAt: new Date(),
    })
    .where(sql`${plans.id} = ${planId}::uuid`);

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'plan.updated',
    targetType: 'plan',
    targetId: planId,
    organizationId: null,
    before: {
      code: before.code,
      priceCents: before.priceCents,
      rateMultiplierBps: before.rateMultiplierBps,
    },
    after: {
      code: input.code,
      priceCents: input.priceCents,
      rateMultiplierBps: input.rateMultiplierBps,
    },
  });

  return { ok: true, id: planId };
}

/**
 * Archive a plan by making it non-public.
 *
 * There is NO DELETE, and that is deliberate. `subscriptions.plan_id` is
 * a NOT NULL foreign key with no ON DELETE behaviour, so deleting a plan
 * any customer is on either fails outright or — worse, if the FK is ever
 * relaxed — orphans their subscription and silently removes their
 * entitlements on the next sync.
 *
 * `public = false` removes it from `/api/plans` and the pricing page
 * while leaving every live subscription intact and billable. A plan can
 * only be retired once `subscriberCount` is zero, and this refuses
 * before anything is written.
 */
export async function retirePlan(
  actorId: string,
  planId: string,
): Promise<PlanActionResult> {
  const plan = await db.query.plans.findFirst({ where: sql`${plans.id} = ${planId}::uuid` });
  if (!plan) return { ok: false, error: 'not_found', message: 'No such plan.' };

  const subs = await db.execute(sql`
    SELECT count(*)::int AS n FROM subscriptions
     WHERE plan_id = ${planId}::uuid
       AND status IN ('active','trialing','past_due','unpaid')
  `);
  const live = Number((subs[0] as { n: number })?.n ?? 0);
  if (live > 0) {
    return {
      ok: false,
      error: 'conflict',
      message: `${live} subscription${live === 1 ? '' : 's'} still on this plan. Move them first — retiring would leave paying customers without a tier.`,
    };
  }

  await db
    .update(plans)
    .set({ public: false, updatedAt: new Date() })
    .where(sql`${plans.id} = ${planId}::uuid`);

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'plan.retired',
    targetType: 'plan',
    targetId: planId,
    organizationId: null,
    before: { code: plan.code, public: true },
    after: { code: plan.code, public: false },
  });

  return { ok: true, id: planId };
}

/** Re-publish a retired plan. */
export async function restorePlan(
  actorId: string,
  planId: string,
): Promise<PlanActionResult> {
  const plan = await db.query.plans.findFirst({ where: sql`${plans.id} = ${planId}::uuid` });
  if (!plan) return { ok: false, error: 'not_found', message: 'No such plan.' };

  await db
    .update(plans)
    .set({ public: true, updatedAt: new Date() })
    .where(sql`${plans.id} = ${planId}::uuid`);

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'plan.restored',
    targetType: 'plan',
    targetId: planId,
    organizationId: null,
    before: { code: plan.code, public: false },
    after: { code: plan.code, public: true },
  });

  return { ok: true, id: planId };
}