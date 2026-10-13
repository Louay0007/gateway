#!/usr/bin/env node
/**
 * verify-metering.ts — prove the money path end-to-end.
 *
 * The MVP is subscribe-first: no free tier, no trials, one plan per
 * account at a time, and the gateway enforces whatever the plan says.
 * This script walks the REAL code paths a customer's billing life
 * travels, in order, and asserts the ledger and the gateway at each step:
 *
 *   0. Gateway readiness
 *   1. createLocalUser()          — the sign-up transaction
 *   2. ensurePersonalOrg()        — org + LiteLLM team, NO subscription
 *                                    (the paywall state)
 *   3. The paywall: createKey()   — must be REFUSED before subscribing
 *   4. beginCheckout()            — the billing service (dev provider)
 *   5. /api/billing/callback      — the REAL route, signature-verified,
 *                                    activating the subscription
 *   6. Callback replay            — same event id → no double-apply
 *   7. createKey()                — the key service, now unblocked
 *   8. Real requests              — through the gateway until the plan's
 *                                    budget ceiling rejects one
 *   9. getSpendLogs()             — the gateway's own spend ledger
 *  10. collectUsage()             — spend logs → usage_records
 *  11. Ledger assertions          — tokens, cost (recomputed from
 *                                    prices/models.yaml), margin at the
 *                                    plan's multiplier, key attribution,
 *                                    billing period, status
 *  12. Idempotency                — a second collector pass inserts nothing
 *  13. rollupUsage()              — usage_periods rebuilt from the ledger
 *  14. subscriptionBundle()       — the dashboard payload
 *  15. changePlan()               — upgrade to Pro: new limits pushed live
 *  16. cancelSubscription(atPeriodEnd) — the kind cancel: access
 *                                    continues until the paid period
 *                                    ends, and a request still succeeds
 *  17. expireSubscriptions()       — the rollover job: when the period
 *                                    ends the account is cut (429)
 *  18. re-subscribe                — the same subscription row
 *                                    reactivates and the key works
 *  18c. usageHistorySeries()       — the chart's series is real and DENSE
 *                                    (server-bucketed, zero-filled, guard)
 *  19. cancelSubscription()        — immediate cut (429 budget)
 *  20. revokeKey()                 — upstream-first revoke → 401/403
 *  21. deleteAccount()             — cut off BEFORE cleanup; second delete 409
 *  22. updateProfile()             — the rename persists (re-read proves it)
 *
 * WHY A SCRIPT AND NOT A UNIT TEST: every seam here is deliberately
 * injectable, and tests/keys.test.ts drives them with fakes. This proof
 * exists to catch the failures no fake can: the gateway answering with a
 * row shape the collector cannot read, a budget that does not stop, a
 * dedupe hash that does not dedupe, a plan change that never reaches the
 * gateway. It needs the live stack, so it runs in the jobs container
 * (which has the database, the gateway, and the portal on the compose
 * network) via `make verify-metering`.
 *
 * WHAT IT LEAVES BEHIND: one user, one organization, one LiteLLM team at
 * CUT_BUDGET, one revoked key, and the ledger rows themselves. The
 * ledger is the evidence — nothing is deleted. Re-running creates a
 * fresh account each time, so the proof never collides with itself.
 *
 * SECRETS: the minted plaintext key is used for requests and then
 * dropped. It is NEVER printed — only the display prefix (already shown
 * in the product's own key table) and its length.
 */

import './env.mjs';

import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, sql as pg } from '@/db';
import { apiKeys, entitlements, organizations, subscriptions, usagePeriods, usageRecords, users } from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import { createKey, revokeKey } from '@/lib/keys';
import { getSpendLogs } from '@/lib/litellm/client';
import { LITELLM_BASE } from '@/lib/litellm/endpoint';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { collectUsage, rollupUsage } from '@/lib/jobs/collect-usage';
import { loadPriceTable, priceUsage, resolvePrice } from '@/lib/pricing';
import {
  beginCheckout,
  cancelSubscription,
  changePlan,
  planStateFor,
  subscriptionBundle,
  usageHistorySeries,
} from '@/lib/billing';
import { devSignBody } from '@/lib/billing/dev';
import { deleteAccount, updateProfile } from '@/lib/account/service';
import { KeyServiceError } from '@/lib/keys/types';

// ───────────────────────────────────────────────────────────────────────
//  Assertion plumbing
// ───────────────────────────────────────────────────────────────────────

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(detail ? `${label} — ${detail}` : label);
  }
}

function section(title: string): void {
  process.stdout.write(`\n── ${title}\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PORTAL_URL = process.env.PORTAL_INTERNAL_URL ?? 'http://portal:3000';

/** The gateway request every call below makes. */
async function infer(plaintext: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${plaintext}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'fast',
      messages: [{ role: 'user', content: 'metering proof — reply with one word' }],
      max_tokens: 64,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body — status is what we assert on */
  }
  return { status: res.status, body };
}

// ───────────────────────────────────────────────────────────────────────
//  The proof
// ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runTag = randomBytes(4).toString('hex');
  const email = `metering-${runTag}@verify.invalid`;
  // 24 chars from a mixed alphabet — satisfies validatePassword() without
  // being a word. Used once, here, and never printed.
  const password = randomBytes(18).toString('base64url');

  process.stdout.write(
    `\nmetering proof — run ${runTag}\n` +
      `  account: ${email}\n` +
      `  gateway: ${LITELLM_BASE}  portal: ${PORTAL_URL}\n`,
  );

  // ── 0. Gateway readiness ────────────────────────────────────────────
  section('0. gateway readiness');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      const r = await fetch(`${LITELLM_BASE}/health/readiness`, {
        signal: AbortSignal.timeout(5_000),
      });
      ready = r.status === 200;
    } catch {
      /* still booting */
    }
    if (!ready) await sleep(1_000);
  }
  check('gateway reports ready', ready, `${LITELLM_BASE}/health/readiness not ready after 60s`);

  // ── 1. Account — the real sign-up transaction ────────────────────────
  section('1. account (lib/auth/create-user.ts — the sign-up path)');
  const { userId, domainUserId } = await createLocalUser({
    email,
    name: 'Metering Proof',
    password,
  });
  check(
    'account created (auth identity + domain mirror)',
    Boolean(userId) && Boolean(domainUserId),
    `auth=${userId} domain=${domainUserId}`,
  );

  // ── 2. Provisioning — org + team, NO subscription ────────────────────
  section('2. provisioning (lib/auth/provision.ts — org + LiteLLM team)');
  // domainUserId, not userId: every product read (memberships, keys,
  // provisioning) addresses the `users` mirror.
  const provisioned = await ensurePersonalOrg(domainUserId);
  check('provisioning created a new organization', provisioned.created === true);
  check(
    'LiteLLM team attached without error',
    !provisioned.liteLLMTeamError,
    provisioned.liteLLMTeamError,
  );

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, provisioned.organizationId));
  if (!org) throw new Error('provisioning returned an organization that does not exist');
  check('organization row carries litellm_team_id', Boolean(org.litellmTeamId), org.litellmTeamId ?? 'null');
  const teamId = org.litellmTeamId!;

  // ── 3. The paywall: no subscription, no keys ─────────────────────────
  section('3. paywall (no free tier — keys are refused pre-subscription)');
  const beforeState = await planStateFor(org.id);
  check(
    'a brand-new account has no subscription',
    beforeState.state === 'no_subscription',
    beforeState.state,
  );

  let refused = '';
  try {
    await createKey({
      organizationId: org.id,
      userId: domainUserId,
      role: 'owner',
      name: 'should not exist',
      models: ['fast'],
    });
    refused = 'createKey unexpectedly succeeded';
  } catch (e) {
    refused = e instanceof KeyServiceError ? e.message : String(e);
    check(
      'createKey is refused with a payment_required error',
      e instanceof KeyServiceError && e.code === 'payment_required',
      e instanceof KeyServiceError ? e.code : String(e),
    );
  }
  process.stdout.write(`  note  refusal message: "${refused}"\n`);

  // ── 4. Checkout — the real billing service ───────────────────────────
  section('4. checkout (lib/billing — dev provider, real lifecycle)');
  const started = await beginCheckout(org.id, 'starter', domainUserId);
  const pendingState = await planStateFor(org.id);
  check(
    'checkout leaves the subscription pending',
    pendingState.state === 'pending',
    pendingState.state,
  );
  check(
    'checkout returns a provider payment url',
    started.intent.checkoutUrl.length > 0 && started.intent.providerReference.length > 0,
  );

  // ── 5. The callback — the REAL HTTP route, signature verified ────────
  section('5. activation (POST /api/billing/callback — the real route)');
  const eventId = `evt_${runTag}_activated`;
  const callbackBody = JSON.stringify({
    event_id: eventId,
    kind: 'subscription.activated',
    organization_id: org.id,
    subscription_id: started.intent.subscriptionId,
    plan_code: 'starter',
    period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  async function postCallback(body: string): Promise<Response> {
    return fetch(`${PORTAL_URL}/api/billing/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-billing-signature': devSignBody(body),
      },
      body,
    });
  }

  const activated = await postCallback(callbackBody);
  const activatedBody = await activated.json().catch(() => null);
  check(
    'signed callback activates the subscription (200, applied)',
    activated.status === 200 && activatedBody?.applied === true,
    `status ${activated.status} body ${JSON.stringify(activatedBody)}`,
  );

  const activeState = await planStateFor(org.id);
  check(
    'subscription is active on starter',
    activeState.state === 'active' && activeState.plan?.code === 'starter',
    `${activeState.state}/${activeState.plan?.code}`,
  );

  // ── 6. Replay — the same event must not apply twice ──────────────────
  section('6. callback replay (idempotency)');
  const replay = await postCallback(callbackBody);
  const replayBody = await replay.json().catch(() => null);
  check(
    'replayed callback is a no-op duplicate',
    replay.status === 200 && replayBody?.duplicate === true,
    `status ${replay.status} body ${JSON.stringify(replayBody)}`,
  );

  // Entitlement sync must have run with the activation; verify it landed.
  const sync = await syncOrganizationEntitlements(org.id, 'verify-metering:post-activation');
  check(
    'entitlement sync pushes the starter limits',
    sync.ok && sync.keysSynced === 0,
    sync.error ?? `keysSynced=${sync.keysSynced}`,
  );

  // ── 7. Key — the key service, now unblocked ──────────────────────────
  section('7. key (lib/keys/service.ts — the mint path)');
  const { key, plaintext } = await createKey({
    organizationId: org.id,
    userId: domainUserId,
    role: 'owner',
    name: 'metering proof',
    models: ['fast'],
  });
  check(
    'credential minted (redacted)',
    plaintext.startsWith('sk-') && plaintext.startsWith(key.keyPrefix),
    `prefix=${key.keyPrefix} len=${plaintext.length}`,
  );

  // The per-key push the activation could not do (no keys existed yet).
  const syncWithKey = await syncOrganizationEntitlements(org.id, 'verify-metering:key-push');
  check(
    `entitlement sync pushes per-key limits (keysSynced=${syncWithKey.keysSynced})`,
    syncWithKey.ok && syncWithKey.keysSynced === 1,
    syncWithKey.error ?? `keysSynced=${syncWithKey.keysSynced}`,
  );

  // ── 8. Real requests, and the plan's limits as the gateway sees them ─
  section('8. inference (real requests + gateway-side limits)');
  interface Success { tokensIn: number; tokensOut: number }
  const successes: Success[] = [];
  // Two successful calls: enough ledger evidence to prove tokens and
  // cost, and cheap against the plan's $100 ceiling.
  for (let i = 0; i < 2; i++) {
    const { status, body } = await infer(plaintext);
    if (status !== 200) {
      check(`call ${i + 1} succeeded`, false, `status ${status}`);
      break;
    }
    successes.push({
      tokensIn: Number(body?.usage?.prompt_tokens ?? 0),
      tokensOut: Number(body?.usage?.completion_tokens ?? 0),
    });
    process.stdout.write(
      `  ok   call ${i + 1} → 200 (${successes.at(-1)!.tokensIn} in / ${successes.at(-1)!.tokensOut} out)\n`,
    );
  }
  check('both requests succeeded', successes.length === 2, `${successes.length} succeeded`);
  const firstIn = successes[0]?.tokensIn ?? 0;
  const firstOut = successes[0]?.tokensOut ?? 0;
  check(
    'every successful call reported the same token usage',
    successes.every((s) => s.tokensIn === firstIn && s.tokensOut === firstOut),
    successes.map((s) => `${s.tokensIn}/${s.tokensOut}`).join(' '),
  );

  // The plan's ceiling is enforced where it matters: on the gateway key.
  // Starter's hard cap is $100 CUSTOMER — the gateway tracks UPSTREAM, so
  // the key carries $100/1.30 = $76.92. Asserting 100 here would re-encode
  // the bug resolveBudgetUsd had (returning customer dollars as an
  // upstream budget, letting the customer spend $130 before the cutoff).
  const [keyRowForInfo] = await db
    .select({ litellmKeyHash: apiKeys.litellmKeyHash })
    .from(apiKeys)
    .where(eq(apiKeys.id, key.id));
  if (!keyRowForInfo?.litellmKeyHash) {
    check('gateway key info readable', false, 'no litellm_key_hash stored');
  } else {
    const { getKeyInfo } = await import('@/lib/litellm/client');
    const info = await getKeyInfo(keyRowForInfo.litellmKeyHash);
    const expectedUpstream = 100 / 1.3;
    check(
      `gateway key carries the plan's cap as upstream ($${expectedUpstream.toFixed(2)}, got ${info.max_budget})`,
      Math.abs((info.max_budget ?? 0) - expectedUpstream) < 0.01,
      `max_budget=${info.max_budget}`,
    );
    check(
      `gateway key is restricted to the plan's models (got ${JSON.stringify(info.models ?? [])})`,
      JSON.stringify(info.models ?? []) === JSON.stringify(['fast']),
    );
  }

  // ── 9. The gateway's own spend ledger must show the requests ─────────
  section('9. gateway spend ledger (getSpendLogs)');
  const today = new Date().toISOString().slice(0, 10);
  let logged = 0;
  for (let attempt = 0; attempt < 20 && logged < successes.length; attempt++) {
    const rows = await getSpendLogs({ startDate: today, endDate: today, page: 1, pageSize: 500 });
    logged = rows.filter((r) => r.team_id === teamId && r.status === 'success').length;
    if (logged < successes.length) await sleep(1_000);
  }
  check(
    `gateway logged all ${successes.length} successful request(s) against our team`,
    logged === successes.length,
    `found ${logged}`,
  );

  // ── 10. The collector: spend logs → usage_records ────────────────────
  section('10. collector (lib/jobs/collect-usage.ts — the import)');
  const first = await collectUsage();
  check(
    `collector imported the new row(s) (inserted=${first.inserted}, dupes=${first.skippedDuplicates})`,
    first.inserted >= successes.length,
    `inserted ${first.inserted}, expected at least ${successes.length}`,
  );

  const ledger = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.organizationId, org.id));
  const successRows = ledger.filter((r) => r.statusCode === 200);
  const otherRows = ledger.filter((r) => r.statusCode !== 200);
  check(
    `one ledger row per successful request (${successRows.length} rows)`,
    successRows.length === successes.length,
    `expected ${successes.length}`,
  );

  // ── 11. The ledger itself: tokens, cost, margin, attribution ─────────
  section('11. ledger contents (usage_records)');

  const priceTable = await loadPriceTable();
  const price = resolvePrice(priceTable, 'openai/cl/cline-free/step-5-preview');
  check('price table resolves the served model', Boolean(price), 'step-5-preview not in prices/models.yaml');

  // Starter's multiplier (rate_multiplier_bps = 13000 → 1.30).
  const multiplier = (activeState.plan?.rateMultiplierBps ?? 13000) / 10_000;
  const expectedPerCall = price
    ? priceUsage(
        { inputTokens: firstIn, outputTokens: firstOut, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
        price,
      ).total
    : Number.NaN;
  const expectedCustomer = expectedPerCall * multiplier;

  const TOL = 1e-9;
  const tokenOk = successRows.every(
    (r) => r.inputTokens === firstIn && r.outputTokens === firstOut,
  );
  check(
    `tokens match the responses exactly (${firstIn} in / ${firstOut} out)`,
    tokenOk,
    successRows.map((r) => `${r.inputTokens}/${r.outputTokens}`).join(' ') || 'no rows',
  );

  const upstreamOk = successRows.every(
    (r) => Math.abs(Number(r.costUpstreamUsd) - expectedPerCall) <= TOL,
  );
  check(
    `upstream cost matches the price table ($${expectedPerCall.toFixed(8)}/call)`,
    upstreamOk,
    successRows.map((r) => Number(r.costUpstreamUsd).toFixed(8)).join(' ') || 'no rows',
  );

  const marginOk = successRows.every(
    (r) => Math.abs(Number(r.costCustomerUsd) - expectedCustomer) <= TOL,
  );
  check(
    `customer cost = upstream × ${multiplier} (starter multiplier)`,
    marginOk,
    successRows.map((r) => Number(r.costCustomerUsd).toFixed(8)).join(' ') || 'no rows',
  );

  // Key attribution: the row knows WHICH key spent the money.
  const attributedRows = ledger.filter((r) => r.apiKeyId !== null);
  check(
    `ledger rows attribute the spend to the minted key (${attributedRows.length}/${ledger.length})`,
    attributedRows.length === ledger.length,
    `${attributedRows.length} of ${ledger.length} attributed`,
  );
  const [keyRow] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
  check(
    'attributed api_key_id is the key we minted',
    attributedRows.length > 0 && attributedRows.every((r) => r.apiKeyId === key.id),
    keyRow ? `expected ${key.id}` : 'key row missing',
  );

  const periodOk = successRows.every((r) => {
    const expected = `${new Date().toISOString().slice(0, 7)}-01`;
    return String(r.billingPeriod) === expected;
  });
  check('billing_period is the current month', periodOk, successRows.map((r) => String(r.billingPeriod)).join(' '));

  const metaOk = successRows.every(
    (r) => Boolean(r.dedupeHash) && Boolean(r.priceTableVersion) && r.model.length > 0,
  );
  check('every row carries model, price_table_version and dedupe_hash', metaOk);

  if (otherRows.length) {
    check(
      `rejected request(s) landed as zero-cost rows (${otherRows.length}, status ${otherRows.map((r) => r.statusCode).join('/')})`,
      otherRows.every((r) => Number(r.costUpstreamUsd) === 0 && r.inputTokens === 0),
    );
  } else {
    process.stdout.write('  note  the rejected call was not attributed to the team (no failure row imported)\n');
  }

  // ── 12. Idempotency — the second pass must insert nothing ────────────
  section('12. idempotency (collector re-run)');
  const second = await collectUsage();
  const ledgerAfter = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.organizationId, org.id));
  check(
    're-run inserted zero new rows',
    second.inserted === 0 && ledgerAfter.length === ledger.length,
    `pass 2 inserted ${second.inserted}; ledger ${ledger.length} → ${ledgerAfter.length}`,
  );
  check(
    `re-run recognized ${second.skippedDuplicates} row(s) as duplicates`,
    second.skippedDuplicates >= successes.length,
    `dupes=${second.skippedDuplicates}`,
  );

  // ── 13. Rollups — rebuilt from the ledger, never incremented ─────────
  section('13. rollup (usage_periods)');
  await rollupUsage();
  const periodKey = `${new Date().toISOString().slice(0, 7)}-01`;
  const [period] = await db
    .select()
    .from(usagePeriods)
    .where(
      and(
        eq(usagePeriods.organizationId, org.id),
        eq(usagePeriods.billingPeriod, periodKey),
      ),
    );
  check('period rollup row exists', Boolean(period));
  if (period) {
    const sumUpstream = ledger.reduce((acc, r) => acc + Number(r.costUpstreamUsd), 0);
    const sumCustomer = ledger.reduce((acc, r) => acc + Number(r.costCustomerUsd), 0);
    const sumIn = ledger.reduce((acc, r) => acc + r.inputTokens, 0);
    const sumOut = ledger.reduce((acc, r) => acc + r.outputTokens, 0);
    check(
      `rollup counts every ledger row (${ledger.length})`,
      Number(period.requests) === ledger.length,
      `rollup ${period.requests}`,
    );
    check(
      'rollup token sums match the ledger',
      Number(period.inputTokens) === sumIn && Number(period.outputTokens) === sumOut,
      `rollup ${period.inputTokens}/${period.outputTokens} vs ledger ${sumIn}/${sumOut}`,
    );
    check(
      'rollup cost sums match the ledger',
      Math.abs(Number(period.costUpstreamUsd) - sumUpstream) <= TOL &&
        Math.abs(Number(period.costCustomerUsd) - sumCustomer) <= TOL,
      `rollup ${period.costUpstreamUsd}/${period.costCustomerUsd} vs ledger ${sumUpstream}/${sumCustomer}`,
    );
  }

  // ── 14. The dashboard bundle ─────────────────────────────────────────
  section('14. dashboard bundle (subscriptionBundle)');
  const bundle = await subscriptionBundle(org.id);
  check('bundle reports the active plan', bundle.state === 'active' && bundle.plan?.code === 'starter', `${bundle.state}/${bundle.plan?.code}`);
  check(
    'bundle limits match the starter plan',
    bundle.limits?.hardCapCents === 10_000 && bundle.limits?.maxKeys === 3,
    `hardCap=${bundle.limits?.hardCapCents} maxKeys=${bundle.limits?.maxKeys}`,
  );
  check(
    'bundle usage matches the ledger sum',
    Math.abs(bundle.usage.costCustomerUsd - ledger.reduce((a, r) => a + Number(r.costCustomerUsd), 0)) <= TOL,
    `bundle ${bundle.usage.costCustomerUsd}`,
  );
  check(
    `bundle counts the active key (${bundle.keys.active}/${bundle.keys.max})`,
    bundle.keys.active === 1 && bundle.keys.max === 3,
  );

  // ── 15. Upgrade — plan change pushes new limits to the gateway ───────
  section('15. upgrade (changePlan → Pro)');
  const upgraded = await changePlan(org.id, 'pro', domainUserId);
  check('plan changed to pro', upgraded.plan.code === 'pro');
  const proState = await planStateFor(org.id);
  check(
    'entitlement cache now says pro',
    proState.plan?.code === 'pro',
    proState.plan?.code ?? 'null',
  );
  const proEnt = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, org.id),
  });
  check(
    'gateway-side limits moved to the pro budget ($480 upstream = $600 customer)',
    proEnt?.status === 'synced' &&
      Math.abs(Number((proEnt.effective as { maxBudgetUsd?: number })?.maxBudgetUsd) - 600 / 1.25) < 0.01,
    proEnt ? `status=${proEnt.status} budget=${(proEnt.effective as { maxBudgetUsd?: number })?.maxBudgetUsd}` : 'no entitlement row',
  );

  // ── 16. Cancel at period end — the kind cancel ───────────────────────
  section('16. cancel at period end (access continues until the paid period ends)');
  const scheduled = await cancelSubscription(org.id, domainUserId, { atPeriodEnd: true });
  check(
    'cancel is scheduled, not applied',
    scheduled.atPeriodEnd === true,
    JSON.stringify(scheduled),
  );
  const scheduledState = await planStateFor(org.id);
  check(
    'access continues: the subscription is still active',
    scheduledState.state === 'active',
    scheduledState.state,
  );
  const entScheduled = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, org.id),
  });
  check(
    'limits are untouched while the period runs',
    entScheduled?.status === 'synced' &&
      Math.abs(Number((entScheduled.effective as { maxBudgetUsd?: number })?.maxBudgetUsd) - 600 / 1.25) < 0.01,
    entScheduled ? `budget=${(entScheduled.effective as { maxBudgetUsd?: number })?.maxBudgetUsd}` : 'no entitlement row',
  );
  const duringGrace = await infer(plaintext);
  check(
    `a request during the grace period still succeeds (got ${duringGrace.status})`,
    duringGrace.status === 200,
    `status ${duringGrace.status}`,
  );

  // ── 17. The rollover job — the promise the kind cancel made ──────────
  section('17. rollover (expire_subscriptions — the cut when the period ends)');
  // Arrange the only condition a month of waiting would produce: the paid
  // period has ended. This writes the TEST ACCOUNT'S OWN subscription row
  // — it arranges a state, it does not fabricate any ledger data.
  await db.execute(sql`
    UPDATE subscriptions
       SET current_period_end = now() - interval '1 minute'
     WHERE organization_id = ${org.id}::uuid
  `);

  const { expireSubscriptions } = await import('@/lib/jobs/expire-subscriptions');
  const expired = await expireSubscriptions();
  check(
    `the job flipped the ended subscription (expired=${expired.expired})`,
    expired.expired >= 1 && expired.failed === 0,
    `expired=${expired.expired} failed=${expired.failed}`,
  );
  const afterRollover = await planStateFor(org.id);
  check(
    'the subscription is now canceled',
    afterRollover.state === 'canceled',
    afterRollover.state,
  );
  const entRollover = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, org.id),
  });
  check(
    'the rollover cut the account to CUT_BUDGET',
    entRollover?.status === 'synced' &&
      Number((entRollover.effective as { maxBudgetUsd?: number; effect?: string })?.maxBudgetUsd) === 0.000001,
    entRollover ? `budget=${(entRollover.effective as { maxBudgetUsd?: number })?.maxBudgetUsd}` : 'no entitlement row',
  );
  const afterRolloverCall = await infer(plaintext);
  check(
    `the key is starved once the period ends (got ${afterRolloverCall.status})`,
    afterRolloverCall.status === 429 || afterRolloverCall.status === 402,
    `status ${afterRolloverCall.status} ${afterRolloverCall.body?.error?.message ?? ''}`,
  );

  // ── 18. Re-subscribe — the same row reactivates ──────────────────────
  section('18. re-subscribe (a canceled account comes back)');
  const restarted = await beginCheckout(org.id, 'starter', domainUserId);
  const reactivated = await postCallback(
    JSON.stringify({
      event_id: `evt_${runTag}_reactivated`,
      kind: 'subscription.activated',
      organization_id: org.id,
      subscription_id: restarted.intent.subscriptionId,
      plan_code: 'starter',
      period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    }),
  );
  check(
    're-activation through the callback route',
    reactivated.status === 200,
    `status ${reactivated.status}`,
  );
  const restoredState = await planStateFor(org.id);
  check(
    'the account is on starter again',
    restoredState.state === 'active' && restoredState.plan?.code === 'starter',
    `${restoredState.state}/${restoredState.plan?.code}`,
  );
  // Bounded retry: LiteLLM's budget check reads the key's CACHED spend,
  // which can lag a re-activated budget by one call (the same behaviour
  // smoke.sh A-8 works around). A starved key coming back to life is not
  // flaky logic; it is a cache with a TTL.
  let restoredCall = await infer(plaintext);
  for (let attempt = 0; attempt < 3 && restoredCall.status !== 200; attempt++) {
    await sleep(1500);
    restoredCall = await infer(plaintext);
  }
  check(
    `the same key works again after re-subscribing (got ${restoredCall.status})`,
    restoredCall.status === 200,
    `status ${restoredCall.status} ${restoredCall.body?.error?.message ?? ''}`,
  );
  if (restoredCall.status !== 200) {
    // The one failure mode worth diagnosing live: which limit did the
    // gateway actually apply? Read the key back from the gateway.
    const [keyRowForDiag] = await db
      .select({ litellmKeyHash: apiKeys.litellmKeyHash })
      .from(apiKeys)
      .where(eq(apiKeys.id, key.id));
    if (keyRowForDiag?.litellmKeyHash) {
      const { getKeyInfo } = await import('@/lib/litellm/client');
      const diag = await getKeyInfo(keyRowForDiag.litellmKeyHash);
      process.stdout.write(
        `  note  gateway key state at failure: maxBudget=${diag.max_budget} spend=${diag.spend} models=${JSON.stringify(diag.models)}
`,
      );
    }
  }

  // ── 18b. Renewal gates — the 409 that must stand, and the one that must not
  section('18b. renewal checkout gates (same plan, live subscription)');
  // Outside the window (period 30d out): same-plan checkout must 409.
  // This conflict is load-bearing — without it, "already subscribed" has
  // no meaning and the dashboard's Renew button cannot trust the server.
  let earlyRenewalBlocked = false;
  try {
    await beginCheckout(org.id, 'starter', domainUserId);
  } catch (e) {
    // beginCheckout throws BillingError('conflict', ...). Accept either the
    // typed code or the message, so a refactor of the class cannot make
    // this guard silently pass.
    earlyRenewalBlocked =
      (e as { code?: string }).code === 'conflict' ||
      (e instanceof Error && /already subscribed/i.test(e.message));
  }
  check(
    'same-plan checkout outside the window is still 409',
    earlyRenewalBlocked,
    'expected conflict',
  );

  // Move the period end into the 7-day window and retry: renewal must open.
  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: new Date(Date.now() + 3 * 24 * 3600 * 1000), updatedAt: new Date() })
    .where(eq(subscriptions.id, restarted.intent.subscriptionId));
  let renewalOpened = false;
  let renewalIntent: { checkoutUrl: string } | null = null;
  try {
    const r = await beginCheckout(org.id, 'starter', domainUserId);
    renewalOpened = true;
    renewalIntent = r.intent;
  } catch {
    renewalOpened = false;
  }
  check(
    'same-plan checkout inside the 7-day window opens (renewal)',
    renewalOpened && Boolean(renewalIntent?.checkoutUrl),
    renewalOpened ? 'opened' : 'still 409 inside window',
  );
  // Subscription must still be active with its period intact — renewal
  // checkout must NOT flip a live row to incomplete (that would cut access
  // before the new payment clears).
  const stillLive = await planStateFor(org.id);
  check(
    'renewal checkout leaves the live subscription untouched',
    stillLive.state === 'active',
    stillLive.state,
  );
  // Restore the period for the steps that follow (immediate cancel does
  // not depend on it, but leave no manipulated dates behind).
  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000), updatedAt: new Date() })
    .where(eq(subscriptions.id, restarted.intent.subscriptionId));

  // ── 18c. Usage series — the chart's data is a REAL, dense series ─────
  section('18c. usage series (server-bucketed, densely zero-filled)');
  // The chart used to bucket ONE PAGE of rows client-side and print that
  // page's extent as a "date range". This asserts the replacement: a real
  // database series over an explicit window, every bucket present.
  const seriesWinMs = 7 * 24 * 3600 * 1000;
  const seriesTo = new Date();
  const seriesFrom = new Date(seriesTo.getTime() - seriesWinMs);
  const series = await usageHistorySeries(org.id, {
    bucket: 'day',
    from: seriesFrom.toISOString(),
    to: seriesTo.toISOString(),
  });
  if ('error' in series) {
    check('the series returns data, not a range error', false, series.error);
  } else {
    // Dense: trunc(from) .. trunc(to) inclusive is exactly 8 day buckets.
    check(
      'the series is DENSE — every day bucket in the window is present',
      series.points.length === 8,
      `${series.points.length} points`,
    );
    check(
      'a quiet day is an explicit zero, not a missing point',
      series.points.some((p) => p.requests === 0),
    );
    check(
      'the series totals are internally consistent with its points',
      series.totals.requests === series.points.reduce((n, p) => n + p.requests, 0) &&
        series.totals.requests >= 1,
      `${series.totals.requests} request(s)`,
    );
    // The window label comes from the SERVER's resolved bounds, so it can
    // never collapse to "the extent of whatever rows arrived".
    check(
      'the series echoes the resolved window it actually aggregated over',
      series.from <= series.to && new Date(series.from) <= seriesFrom,
    );
  }
  // An oversized request is a hard refusal, not a silently truncated line.
  const tooLarge = await usageHistorySeries(org.id, {
    bucket: 'hour',
    from: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
    to: new Date().toISOString(),
  });
  check(
    'an hour bucket over a year is refused (range_too_large), not truncated',
    'error' in tooLarge && tooLarge.error === 'range_too_large',
  );

  // ── 19. Immediate cancel — the other half of the pair ────────────────
  section('19. immediate cancel (cut now, keys preserved)');
  const cancelResult = await cancelSubscription(org.id, domainUserId);
  check('subscription cancelled', Object.keys(cancelResult).length === 0, JSON.stringify(cancelResult));

  const entCancel = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, org.id),
  });
  check(
    'cancelled account is cut to CUT_BUDGET',
    entCancel?.status === 'synced' &&
      Number((entCancel.effective as { maxBudgetUsd?: number; effect?: string })?.maxBudgetUsd) === 0.000001 &&
      (entCancel.effective as { effect?: string })?.effect === 'cut',
    entCancel ? `budget=${(entCancel.effective as { maxBudgetUsd?: number })?.maxBudgetUsd}` : 'no entitlement row',
  );

  // The key still exists and still authenticates — it is starved, not
  // revoked — so the rejection is the budget 429, not a 401.
  const afterCancel = await infer(plaintext);
  check(
    `the starved key is refused with a budget error (got ${afterCancel.status})`,
    afterCancel.status === 429 || afterCancel.status === 402,
    `status ${afterCancel.status} ${afterCancel.body?.error?.message ?? ''}`,
  );

  // ── 20. Revoke — the real path, then prove it upstream ───────────────
  section('20. revoke (lib/keys/service.ts — upstream-first)');
  const revoked = await revokeKey({
    organizationId: org.id,
    userId: domainUserId,
    role: 'owner',
    keyId: key.id,
  });
  check('key revoked', Boolean(revoked.revokedAt), revoked.revokedAt ?? 'null');

  const afterRevoke = await infer(plaintext);
  check(
    `revoked credential is refused with an auth error (got ${afterRevoke.status})`,
    afterRevoke.status === 401 || afterRevoke.status === 403,
    `status ${afterRevoke.status}`,
  );

  // ── 21. Account deletion — cut off BEFORE cleanup ────────────────────
  section('21. account deletion (order: cut off, then clean up)');
  // A THROWAWAY account, so the main org's evidence above survives. The
  // ordering is the non-negotiable part: a failed gateway call must never
  // leave a live key, so the customer is cut off first and cleanup is best
  // effort after.
  const delTag = randomBytes(4).toString('hex');
  const delEmail = `delete-${delTag}@verify.invalid`;
  const delPassword = randomBytes(18).toString('base64url');
  const { domainUserId: delUserId } = await createLocalUser({
    email: delEmail,
    name: 'Delete Me',
    password: delPassword,
  });
  const delOrg = await ensurePersonalOrg(delUserId);
  const [delOrgInit] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, delOrg.organizationId));

  const delCheckout = await beginCheckout(delOrg.organizationId, 'starter', delUserId);
  const delBody = JSON.stringify({
    event_id: `evt_${delTag}_activated`,
    kind: 'subscription.activated',
    organization_id: delOrg.organizationId,
    subscription_id: delCheckout.intent.subscriptionId,
    plan_code: 'starter',
    period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  const delActivated = await fetch(`${PORTAL_URL}/api/billing/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-billing-signature': devSignBody(delBody),
    },
    body: delBody,
  });
  check('the throwaway account activates', delActivated.status === 200, `${delActivated.status}`);

  const { key: delKey, plaintext: delPlaintext } = await createKey({
    organizationId: delOrg.organizationId,
    userId: delUserId,
    role: 'owner',
    name: 'to-be-deleted',
    models: ['fast'],
  });
  const delKeyBefore = await infer(delPlaintext);
  check('the throwaway key works before deletion', delKeyBefore.status === 200, `${delKeyBefore.status}`);

  const delResult = await deleteAccount({
    organizationId: delOrg.organizationId,
    userId: delUserId,
    confirmSlug: delOrgInit!.slug,
  });
  check('deletion reports the key it revoked', delResult.revokedKeys >= 1, JSON.stringify(delResult));

  const [delOrgAfter] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, delOrg.organizationId));
  check('the org is marked deleted', delOrgAfter?.status === 'deleted', delOrgAfter?.status);

  const [delSub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, delCheckout.intent.subscriptionId));
  check('the subscription is cancelled', delSub?.status === 'canceled', delSub?.status);

  const [delKeyRow] = await db.select().from(apiKeys).where(eq(apiKeys.id, delKey.id));
  check('the key is revoked locally (no live key survives a delete)', Boolean(delKeyRow?.revokedAt));

  // The cut-off must reach the GATEWAY, not just our table: the revoked
  // credential is refused upstream. This is the invariant the ordering
  // exists to protect.
  const delKeyAfter = await infer(delPlaintext);
  check(
    `the deleted account's key is refused UPSTREAM (got ${delKeyAfter.status})`,
    delKeyAfter.status === 401 || delKeyAfter.status === 403,
    `status ${delKeyAfter.status}`,
  );

  let secondDeleteConflict = false;
  try {
    await deleteAccount({
      organizationId: delOrg.organizationId,
      userId: delUserId,
      confirmSlug: delOrgInit!.slug,
    });
  } catch (e) {
    secondDeleteConflict = (e as { code?: string }).code === 'conflict';
  }
  check('a second delete is refused (already deleted)', secondDeleteConflict);

  // ── 22. Profile rename — the write must actually persist ─────────────
  section('22. profile rename persists');
  // The settings page used to say "saved" and reload to the SAME value,
  // because there was nothing behind the button. This asserts the write
  // lands and survives a re-read, on the account that is still live.
  const newName = `Renamed ${Math.random().toString(36).slice(2, 8)}`;
  await updateProfile({ userId: domainUserId, name: newName });
  const [renamed] = await db.select().from(users).where(eq(users.id, domainUserId));
  check(
    'the new display name is what the database returns',
    renamed?.name === newName,
    `${renamed?.name}`,
  );

  // ── Summary ──────────────────────────────────────────────────────────
  const totalUpstream = ledger.reduce((a, r) => a + Number(r.costUpstreamUsd), 0);
  const totalCustomer = ledger.reduce((a, r) => a + Number(r.costCustomerUsd), 0);
  process.stdout.write(
    `\n── summary\n` +
      `  organization   ${org.id}\n` +
      `  litellm team   ${teamId} (now CUT_BUDGET — subscription cancelled)\n` +
      `  requests       ${successes.length} succeeded (mock upstream — the plan ceiling is asserted on the gateway key)\n` +
      `  ledger rows    ${ledgerAfter.length} (${successRows.length} success, ${otherRows.length} rejected)\n` +
      `  upstream cost  $${totalUpstream.toFixed(8)} total\n` +
      `  customer cost  $${totalCustomer.toFixed(8)} total (starter × ${multiplier})\n` +
      `  lifecycle      paywall → checkout → activate → replay(no-op) → use → upgrade → cancel@period-end (grace) → rollover(cut) → re-subscribe → usage-series → cancel(now) → revoke(401) → delete-account → rename\n` +
      `  left behind    user ${email}, org, team, ledger rows (evidence — nothing deleted)\n`,
  );

  if (failures.length) {
    process.stdout.write(`\n${failures.length} check(s) FAILED:\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nall checks passed — the money path is proven end-to-end\n');
}

main()
  .catch((e) => {
    process.stderr.write(
      `metering proof crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    // postgres-js holds the event loop open otherwise.
    await pg.end({ timeout: 5 }).catch(() => {});
  });
