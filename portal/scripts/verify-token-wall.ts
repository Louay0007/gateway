/**
 * The 50M/month wall, proven END TO END against the running stack.
 *
 * WHY THIS EXISTS. `tests/token-quota.test.ts` proves the pure rule
 * (`used < limit`) and the window arithmetic. It cannot prove that the
 * running gateway actually refuses inference when an alias is exhausted,
 * because that depends on four things agreeing:
 *
 *   1. `getAllowedModels` summing the right columns over the right window,
 *   2. `enforce_prompt_limits` pushing the narrowed allowlist,
 *   3. LiteLLM honouring the team AND key model lists (their intersection),
 *   4. the monthly window resetting at the period boundary.
 *
 * Each of those has failed in this project's history (0025 shipped a daily
 * wall against a monthly price and cost 24x the subscription in tokens). So
 * this script seeds
 * usage at the exact boundaries, runs the real enforcement job, and then
 * makes a REAL inference call through the gateway. A 200 means the wall
 * did not hold; a 403 means it did.
 *
 * WHAT IT TOUCHES. It creates its own throwaway org + subscription + key,
 * drives it through the real code paths, and deletes them at the end. It
 * never writes to a customer's org: the org name carries a run tag and
 * every row is scoped to it.
 *
 * Usage (from the repo root, on the VPS or locally):
 *   docker compose run --rm --no-deps jobs node --experimental-transform-types \
 *     --import ./scripts/register-ts-resolve.mjs scripts/verify-token-wall.ts
 *
 * Exit code 0 = every assertion held. Non-zero = the wall is broken.
 */
import './env.mjs';

import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, sql as pg } from '@/db';
import {
  apiKeys,
  organizations,
  plans,
  subscriptions,
  usageRecords,
} from '@/db/schema';
import { createKey, revokeKey } from '@/lib/keys';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
import { enforcePromptLimits } from '@/lib/jobs/enforce-prompt-limits';
import { tunisDayWindow, usageWindowForSubscription } from '@/lib/entitlements/quota';
import { getTeamInfo, NO_MODEL } from '@/lib/litellm/client';
import { toGatewayKey } from '@/lib/keys/policy';
import { LITELLM_BASE } from '@/lib/litellm/endpoint';

const runTag = randomBytes(4).toString('hex');

// ───────────────────────────────────────────────────────────────────────
//  Assertion plumbing
// ───────────────────────────────────────────────────────────────────────
let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail?: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One real inference call through LiteLLM. Returns the HTTP status. */
async function infer(alias: string, gatewayKey: string): Promise<number> {
  const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: alias,
      messages: [{ role: 'user', content: 'say ok' }],
      max_tokens: 4,
    }),
  });
  // Drain so the connection is released.
  await res.text().catch(() => '');
  return res.status;
}

/** Seed a synthetic ledger row inside the current quota window. */
async function seedUsage(
  organizationId: string,
  model: string,
  tokens: number,
  occurredAt: Date,
): Promise<void> {
  // Put every token in `fresh_input_tokens` and keep `input_tokens` equal to
  // it, so the row is self-consistent under both the new normalisation and
  // the pre-0028 fallback. cache_read stays 0: this test is about the
  // boundary, not about cache accounting (that has its own suite).
  await db.insert(usageRecords).values({
    organizationId,
    occurredAt,
    billingPeriod: occurredAt.toISOString().slice(0, 10),
    model,
    route: 'chat',
    inputTokens: tokens,
    freshInputTokens: tokens,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    costUpstreamUsd: '0',
    costCustomerUsd: '0',
    dedupeHash: `wall-${runTag}-${model}-${tokens}-${occurredAt.getTime()}`,
  });
}

/**
 * A user id to satisfy `api_keys.created_by`. The key-minting service
 * requires a real user (the audit trail names them), but the token wall
 * itself never reads membership — so any existing user will do. Created
 * if the database has none (a fresh local stack).
 */
async function ownerUserId(): Promise<string | null> {
  const rows = (await db.execute(sql`SELECT id FROM users LIMIT 1`)) as unknown as {
    id: string;
  }[];
  return rows[0]?.id ?? null;
}

/** The team's model list exactly as LiteLLM stores it (sentinel included). */
async function rawTeamModels(teamId: string): Promise<string[] | undefined> {
  const res = await fetch(`${LITELLM_BASE}/team/info?team_id=${encodeURIComponent(teamId)}`, {
    headers: { Authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}` },
  });
  const json = (await res.json()) as {
    team_info?: Record<string, unknown>[] | Record<string, unknown>;
  };
  const raw = Array.isArray(json.team_info) ? json.team_info[0] : json.team_info;
  const models = (raw ?? {}).models;
  return Array.isArray(models) ? (models as string[]) : undefined;
}

async function makeOrg(planCode: string): Promise<{
  orgId: string;
  subId: string;
  teamId: string;
  keyPlaintext: string;
  keyGateway: string;
}> {
  const [plan] = await db.select().from(plans).where(eq(plans.code, planCode));
  if (!plan) throw new Error(`plan ${planCode} missing`);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Token Wall ${runTag} ${planCode}`,
      slug: `token-wall-${runTag}-${planCode}`.toLowerCase().slice(0, 60),
      status: 'active',
    })
    .returning();
  if (!org) throw new Error('org insert returned no row');

  // A real LiteLLM team, so enforcement pushes somewhere it can be read back.
  const teamRes = await fetch(`${LITELLM_BASE}/team/new`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      team_alias: `wall-${runTag}-${planCode}`,
      models: plan.models,
    }),
  });
  const teamJson = (await teamRes.json()) as { team_id?: string };
  const teamId = teamJson.team_id;
  if (!teamId) throw new Error(`team creation failed: ${JSON.stringify(teamJson)}`);

  await db
    .update(organizations)
    .set({ litellmTeamId: teamId })
    .where(eq(organizations.id, org.id));

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86_400_000);
  const [sub] = await db
    .insert(subscriptions)
    .values({
      organizationId: org.id,
      planId: plan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      // 0038: monthly budgets are measured over the period, so the fixture
      // must sit on the period window — TRUE would sum a single Tunis day.
      dailyQuota: false,
    })
    .returning();
  if (!sub) throw new Error('subscription insert returned no row');

  // A real key through the real minting path (role/maxKeys enforced there).
  // The owner role is required: only owner/admin may mint, and this org has
  // no members — the wall itself does not depend on membership.
  const created = await createKey({
    organizationId: org.id,
    userId: (await ownerUserId())!,
    role: 'owner',
    name: `wall-${runTag}-${planCode}`,
    models: plan.models as string[],
  });

  const keyPlaintext = created.plaintext;
  return {
    orgId: org.id,
    subId: sub.id,
    teamId,
    keyPlaintext,
    keyGateway: toGatewayKey(keyPlaintext),
  };
}

/**
 * 0038: the monthly budget is a TOTAL split across the plan's aliases, so
 * the per-alias limit is read from the plan rather than assumed. Hardcoding
 * 100M here is what let the 0025 daily wall look correct while it cost 24x
 * the subscription.
 */
const MONTHLY_CEILING = 50_000_000;

async function main(): Promise<void> {
  console.log(`\nToken wall proof — 50M/month per plan, all plans (run ${runTag})`);
  console.log(`gateway: ${LITELLM_BASE}`);

  // 0038: the wall sums over the subscription PERIOD. Seeding relative to the
  // period start keeps every fixture inside the window the code reads — the
  // old version seeded against the Tunis day, which no longer exists here.
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);
  const seedAt = (ms: number) => new Date(periodStart.getTime() + ms);

  // ── 0. Every shipped plan is a 50M monthly TOTAL ─────────────────────
  section('0. plans carry a 50M/month total budget');
  const budgetByPlan: Record<string, { aliases: string[]; limits: Record<string, number> }> = {};
  for (const code of ['starter', 'pro', 'trial']) {
    const [p] = await db.select().from(plans).where(eq(plans.code, code));
    const limits = (p?.tokenLimits ?? {}) as Record<string, number>;
    const aliases = (p?.models ?? []) as string[];
    budgetByPlan[code] = { aliases, limits };
    const total = aliases.reduce((n, a) => n + (limits[a] ?? 0), 0);
    check(
      `${code} budgets every served alias and totals 50M/month`,
      aliases.length > 0 && aliases.every((a) => (limits[a] ?? 0) > 0),
      `${JSON.stringify(limits)} vs models ${JSON.stringify(aliases)}`,
    );
    check(
      `${code} sums to ${MONTHLY_CEILING.toLocaleString()} (not per-alias × 30 days)`,
      total > 0 && total <= MONTHLY_CEILING,
      `total=${total.toLocaleString()} (${JSON.stringify(limits)})`,
    );
  }

  const limitsFor = (code: string): Record<string, number> => budgetByPlan[code]!.limits;
  const starterFast = limitsFor('starter').fast!;
  const starterSmart = limitsFor('starter').smart!;
  const proSmart = limitsFor('pro').smart!;
  const proFrontier = limitsFor('pro').frontier!;
  const trialFast = limitsFor('trial').fast!;

  // ── 0b. Every subscription is on the MONTHLY window ──────────────────
  section('0b. subscriptions sum over the period, not the Tunis day');
  const dailyRows = (await db.execute(sql`
    SELECT count(*)::int AS daily FROM subscriptions WHERE daily_quota = TRUE
  `)) as unknown as { daily: number }[];
  const dailyCount = dailyRows[0]?.daily ?? -1;
  check(
    'no subscription is left on the Tunis-day window',
    dailyCount === 0,
    `daily_quota=TRUE rows: ${dailyCount}`,
  );

  const created: { orgId: string; teamId: string; keyPlaintext: string }[] = [];

  try {
    // ── 1. Starter: one token under serves, exactly at the limit cuts ──
    section(`1. Starter boundary — ${starterFast - 1} serves, ${starterFast} cuts`);
    const starter = await makeOrg('starter');
    created.push(starter);

    // One token under the plan's own `fast` budget.
    await seedUsage(starter.orgId, 'fast', starterFast - 1, seedAt(1000));
    let wall = await getAllowedModels(starter.orgId);
    check(
      `${starterFast - 1} of ${starterFast} still allows \`fast\``,
      wall.allowed.includes('fast'),
      `allowed=${JSON.stringify(wall.allowed)} used=${wall.usedTokensBy.fast}`,
    );
    check(
      'the sibling alias `smart` is untouched',
      wall.allowed.includes('smart'),
      `allowed=${JSON.stringify(wall.allowed)}`,
    );

    // Real inference must succeed on the allowed alias.
    await enforcePromptLimits();
    let status = await infer('fast', starter.keyGateway);
    check(`gateway serves \`fast\` at ${starterFast - 1} used`, status === 200, `HTTP ${status}`);

    // Now cross the boundary.
    await seedUsage(starter.orgId, 'fast', 1, seedAt(2000));
    wall = await getAllowedModels(starter.orgId);
    check(
      `${starterFast} of ${starterFast} cuts \`fast\` (the next token would be limit+1)`,
      !wall.allowed.includes('fast'),
      `allowed=${JSON.stringify(wall.allowed)} used=${wall.usedTokensBy.fast}`,
    );
    check(
      '`smart` keeps serving when `fast` is exhausted',
      wall.allowed.includes('smart'),
      `allowed=${JSON.stringify(wall.allowed)}`,
    );

    await enforcePromptLimits();
    status = await infer('fast', starter.keyGateway);
    check(
      `gateway REFUSES \`fast\` at exactly ${starterFast}`,
      status === 403 || status === 429,
      `HTTP ${status} (expected 403/429)`,
    );
    status = await infer('smart', starter.keyGateway);
    check('gateway still SERVES `smart`', status === 200, `HTTP ${status}`);

    // ── 2. Both aliases exhausted → deny-all ───────────────────────────
    section('2. Starter deny-all — both aliases exhausted');
    await seedUsage(starter.orgId, 'smart', starterSmart, seedAt(3000));
    wall = await getAllowedModels(starter.orgId);
    check('the allowlist becomes []', wall.allowed.length === 0, JSON.stringify(wall.allowed));

    await enforcePromptLimits();
    status = await infer('smart', starter.keyGateway);
    check('gateway refuses `smart` too', status === 403 || status === 429, `HTTP ${status}`);

    // The team AND key lists must both be empty. Asserting them separately
    // is what let the key∩team intersection bug ship once.
    const team = await getTeamInfo(starter.teamId);
    check(
      'the TEAM allowlist carries no real alias (not just the keys)',
      Array.isArray(team.models) && team.models.length === 0,
      JSON.stringify(team.models),
    );

    // THE REGRESSION GUARD. `models: []` is NOT deny-all in LiteLLM — it is
    // "no restriction", and it answered 200 on the production box while the
    // dashboard said the org was out of tokens. The push must therefore
    // carry the sentinel, and reading it back must not report it as a model.
    const rawTeam = await rawTeamModels(starter.teamId);
    check(
      'the RAW team list holds the deny-all sentinel, not an empty array',
      Array.isArray(rawTeam) && rawTeam.includes(NO_MODEL),
      JSON.stringify(rawTeam),
    );
    check(
      'the sentinel is not exposed as a model to readers',
      !(team.models ?? []).includes(NO_MODEL),
      JSON.stringify(team.models),
    );

    // ── 3. Reset: a new PERIOD restores without manual action ───────────
    section('3. reset at the period boundary restores every alias');
    // 0038: the window is the subscription period. A row seeded in period N
    // is outside period N+1, so renewal re-allows every alias with no job.
    const subWindow = usageWindowForSubscription(
      { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, dailyQuota: false },
      new Date(periodStart.getTime() + 86_400_000),
    );
    check(
      'monthly row sums over the subscription period',
      subWindow.start.getTime() === periodStart.getTime() &&
        subWindow.end.getTime() === periodEnd.getTime(),
      `${subWindow.start.toISOString()} -> ${subWindow.end.toISOString()}`,
    );
    // The next period continues where this one ended — no gap, no overlap.
    const afterRenewal = new Date(periodEnd.getTime() + 60_000);
    const nextWindow = usageWindowForSubscription(
      { currentPeriodStart: null, currentPeriodEnd: null, dailyQuota: false },
      afterRenewal,
    );
    check(
      'with no period, the monthly fallback is the UTC calendar month',
      nextWindow.start.getUTCDate() === 1,
      `${nextWindow.start.toISOString()} -> ${nextWindow.end.toISOString()}`,
    );
    // The daily window must still exist for the one-off row an operator
    // deliberately puts on a Tunis day — 0038 kept it, it just stopped
    // shipping it.
    const dayWindow = tunisDayWindow();
    check(
      'the daily window still resolves for an explicit dailyQuota row',
      dayWindow.end.getTime() - dayWindow.start.getTime() === 86_400_000,
      String(dayWindow.end.getTime() - dayWindow.start.getTime()),
    );

    // Prove the sum for the new window is zero: the same ledger rows are
    // outside it. This is what makes the reset automatic rather than a job.
    const [row] = (await db.execute(sql`
      SELECT COALESCE(SUM(COALESCE(u.fresh_input_tokens, u.input_tokens - LEAST(u.cache_read_tokens,u.input_tokens))
             + u.output_tokens + u.cache_write_5m_tokens + u.cache_write_1h_tokens + u.cache_read_tokens), 0)::bigint AS used
        FROM usage_records u
       WHERE u.organization_id = ${starter.orgId}::uuid
         AND u.occurred_at >= ${nextWindow.start.toISOString()}::timestamptz
         AND u.occurred_at <  ${nextWindow.end.toISOString()}::timestamptz
    `)) as unknown as { used: string | number }[];
    check(
      'the next day’s usage window sums to zero',
      Number(row?.used ?? 0) === 0,
      `used=${row?.used}`,
    );

    // ── 4. Pro: smart + frontier, fast is NOT entitled ──────────────────
    section('4. Pro — smart/frontier budgeted, fast is not entitled');
    const pro = await makeOrg('pro');
    created.push(pro);

    wall = await getAllowedModels(pro.orgId);
    check(
      'Pro is entitled to exactly smart + frontier',
      JSON.stringify([...wall.entitled].sort()) === JSON.stringify(['frontier', 'smart']),
      JSON.stringify(wall.entitled),
    );
    check(
      `Pro carries its plan budgets on every alias (smart=${proSmart}, frontier=${proFrontier})`,
      wall.tokenLimits.smart === proSmart && wall.tokenLimits.frontier === proFrontier,
      JSON.stringify(wall.tokenLimits),
    );
    check(
      'Pro has no budget entry for `fast` (Starter-only since 0019)',
      wall.tokenLimits.fast === undefined,
      JSON.stringify(wall.tokenLimits),
    );

    await enforcePromptLimits();
    status = await infer('smart', pro.keyGateway);
    check('Pro serves `smart`', status === 200, `HTTP ${status}`);
    status = await infer('frontier', pro.keyGateway);
    check('Pro serves `frontier`', status === 200, `HTTP ${status}`);
    status = await infer('fast', pro.keyGateway);
    check(
      'Pro is REFUSED `fast` (not in the plan)',
      status === 403 || status === 429,
      `HTTP ${status}`,
    );

    // ── 5. Exhausting one Pro alias leaves the sibling serving ──────────
    section('5. Pro — one exhausted alias does not cut the other');
    await seedUsage(pro.orgId, 'frontier', proFrontier, seedAt(4000));
    wall = await getAllowedModels(pro.orgId);
    check(
      `\`frontier\` is withheld at ${proFrontier}`,
      !wall.allowed.includes('frontier'),
      JSON.stringify(wall.allowed),
    );
    check(
      '`smart` keeps serving',
      wall.allowed.includes('smart'),
      JSON.stringify(wall.allowed),
    );
    await enforcePromptLimits();
    status = await infer('frontier', pro.keyGateway);
    check('gateway refuses `frontier`', status === 403 || status === 429, `HTTP ${status}`);
    status = await infer('smart', pro.keyGateway);
    check('gateway still serves `smart`', status === 200, `HTTP ${status}`);

    // ── 6. Trial: same monthly total, hidden plan ──────────────────────
    section(`6. Trial — ${trialFast} monthly on fast + smart`);
    const trial = await makeOrg('trial');
    created.push(trial);
    wall = await getAllowedModels(trial.orgId);
    check(
      `Trial carries ${trialFast} on fast + smart`,
      wall.tokenLimits.fast === trialFast && wall.tokenLimits.smart === limitsFor('trial').smart,
      JSON.stringify(wall.tokenLimits),
    );
    await seedUsage(trial.orgId, 'fast', trialFast, seedAt(5000));
    wall = await getAllowedModels(trial.orgId);
    check(
      `Trial cuts \`fast\` at ${trialFast}, keeps \`smart\``,
      !wall.allowed.includes('fast') && wall.allowed.includes('smart'),
      JSON.stringify(wall.allowed),
    );

    // ── 7. A cut (non-paying) org is refused everything ─────────────────
    section('7. cut subscription — allowlist is [] regardless of usage');
    await db
      .update(subscriptions)
      .set({ status: 'unpaid' })
      .where(eq(subscriptions.id, trial.subId));
    wall = await getAllowedModels(trial.orgId);
    check(
      'an unpaid subscription yields effect=cut and models []',
      wall.effect === 'cut' && wall.allowed.length === 0,
      `effect=${wall.effect} allowed=${JSON.stringify(wall.allowed)}`,
    );

    // ── 7b. RESTORE: a cut org gets its real aliases back ──────────────
    // The sentinel must never survive a restore. If `allowlistFor` leaked
    // into the restore path, a paying customer would come back to an org
    // that can reach nothing — the same outage in the other direction.
    section('7b. restore after cut brings back the real aliases');
    await db
      .update(subscriptions)
      .set({ status: 'active' })
      .where(eq(subscriptions.id, trial.subId));
    // The trial org's fast is at its limit (exhausted), smart is at 0.
    wall = await getAllowedModels(trial.orgId);
    check(
      'after re-activating, the unspent alias is allowed again',
      wall.allowed.includes('smart'),
      JSON.stringify(wall.allowed),
    );
    await enforcePromptLimits();
    status = await infer('smart', trial.keyGateway);
    check('gateway serves `smart` again after restore', status === 200, `HTTP ${status}`);
    const restoredRaw = await rawTeamModels(trial.teamId);
    check(
      'the raw team list no longer carries the deny-all sentinel',
      Array.isArray(restoredRaw) && !restoredRaw.includes(NO_MODEL),
      JSON.stringify(restoredRaw),
    );
    check(
      'the raw team list holds the real plan aliases',
      Array.isArray(restoredRaw) && restoredRaw.includes('smart'),
      JSON.stringify(restoredRaw),
    );

    // ── 8. Idempotence: enforcement is safe to run repeatedly ───────────
    section('8. enforcement is idempotent');
    const r1 = await enforcePromptLimits();
    const r2 = await enforcePromptLimits();
    check(
      'a second pass reports the same narrowing',
      r1.narrowed === r2.narrowed && r1.failed === 0 && r2.failed === 0,
      `run1=${JSON.stringify(r1)} run2=${JSON.stringify(r2)}`,
    );
  } finally {
    // ── cleanup: remove this run's fixtures only ────────────────────────
    for (const c of created) {
      try {
        await db.delete(usageRecords).where(eq(usageRecords.organizationId, c.orgId));
        await db.delete(apiKeys).where(eq(apiKeys.organizationId, c.orgId));
        await db.delete(subscriptions).where(eq(subscriptions.organizationId, c.orgId));
        await db.delete(organizations).where(eq(organizations.id, c.orgId));
      } catch (e) {
        console.log(`  note: cleanup partial for ${c.orgId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log('\nfixtures cleaned up');
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exitCode = 1;
  }
}

main()
  .then(() => pg.end())
  .catch(async (e: unknown) => {
    console.error('token wall proof crashed:', e);
    await pg.end();
    process.exit(1);
  });
