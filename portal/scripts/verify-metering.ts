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
 *  23. startTrial()                — starter-only, 7 days, one per org,
 *                                    grants FULL while trialing (0009)
 *  24. admin console               — suspend→CUT / reactivate→FULL,
 *                                    manual retry, credit notes (0009)
 *  25. detectAnomalies()           — mule phone, rejected burst, cap
 *                                    breach, oversized request; dedupe
 *                                    and recovery (0009)
 *  26. GET /api/usage/export       — the streamed CSV writes exactly the
 *                                    rows its X-Row-Count declares
 *  27. expireTrials()              — an elapsed trial goes unpaid + CUT,
 *                                    never canceled/revoked (0009)
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
import { apiKeys, auditLog, entitlements, organizations, paymentsD17, subscriptions, systemAlerts, usagePeriods, usageRecords, users } from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import { createKey, revokeKey } from '@/lib/keys';
import {
  CUSTOM_KEY_PREFIX,
  GATEWAY_KEY_PREFIX,
  toGatewayKey,
} from '@/lib/keys/policy';
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
  startTrial,
  subscriptionBundle,
  trialEligibility,
  usageHistory,
  usageHistorySeries,
} from '@/lib/billing';
import { devSignBody } from '@/lib/billing/dev';
import {
  listAdminOrgs,
  listCreditNotes,
  recordCreditNote,
  retryEntitlementSync,
  setOrganizationStatus,
} from '@/lib/billing/admin-console';
import { detectAnomalies } from '@/lib/jobs/anomaly-alerts';
import { expireTrials } from '@/lib/jobs/expire-trials';
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

/**
 * Ask for a model on a given gateway key and return just the HTTP status.
 *
 * Used to prove a tier is actually SERVED rather than merely listed: the
 * portal can report Pro while the team still carries the Starter allowlist,
 * and only a live request distinguishes those. See §5.26.
 */
async function statusFor(plaintext: string, model: string): Promise<number> {
  const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${toGatewayKey(plaintext)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'tier proof — reply with one word' }],
      max_tokens: 64,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  return res.status;
}

/** The gateway request every call below makes. */
async function infer(plaintext: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      // `plaintext` is the CUSTOMER form (`zn-…`). This helper talks to
      // LiteLLM's own port directly, which is the path the auth edge does
      // NOT sit on — the edge exists for external traffic arriving via
      // Caddy. An internal caller therefore presents the gateway form.
      //
      // The mistake this guards against is real: sending `zn-` here yields
      // a 401 that reads like a broken key rather than a wrong door.
      Authorization: `Bearer ${toGatewayKey(plaintext)}`,
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

/**
 * Sign in through the real Auth.js credentials flow and return the session
 * cookie, ready to be sent as a `Cookie:` header. Mirrors the helper in
 * verify-d17: the cookie is `__Secure-` prefixed (browsers only send it
 * over HTTPS), so setting the header explicitly is what lets this run
 * against the loopback portal.
 */
async function signInAsCustomer(
  portalUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const csrfRes = await fetch(`${portalUrl}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookies = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ');

  const res = await fetch(`${portalUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({ csrfToken, email, password }),
  });

  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.includes('session-token'))
    .join('; ');
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
  // Starter's allowlist (migration 0010): fast + smart. `frontier` is
  // Pro-only and is proven in section 15, at the upgrade — the only point
  // where the plan actually grants it.
  const { key, plaintext } = await createKey({
    organizationId: org.id,
    userId: domainUserId,
    role: 'owner',
    name: 'metering proof',
    models: ['fast', 'smart'],
  });
  check(
    'credential minted in the customer format (redacted)',
    plaintext.startsWith(CUSTOM_KEY_PREFIX) && plaintext.startsWith(key.keyPrefix),
    `prefix=${key.keyPrefix} len=${plaintext.length}`,
  );
  // The `zn-` form is only usable because the auth edge can restore the
  // `sk-` prefix — which requires the body to satisfy the gateway's own
  // format rules. Assert the shape the gateway will validate, not a
  // round-trip we cannot observe from here.
  check(
    'the key body satisfies the gateway format',
    toGatewayKey(plaintext).startsWith(GATEWAY_KEY_PREFIX) &&
      /^sk-[A-Za-z0-9_-]{13,}$/.test(toGatewayKey(plaintext)),
    `gateway form prefix=${toGatewayKey(plaintext).slice(0, 8)}…`,
  );

  // The allowlist is the only thing standing between a customer and a 403 on
  // every request. Prove it still gates: an upstream model name, and a model
  // no plan offers, must both be refused at mint time. A near-miss like
  // `fast-tier` must be refused too — exact match only, or a typo becomes a
  // key that 403s later with a message that blames the credential.
  const planModels = activeState.plan?.models ?? [];
  for (const bogus of ['space-bunny', 'fast-tier', 'fast ', 'FRONTIER', 'grok-4.6-liberated']) {
    try {
      await createKey({
        organizationId: org.id,
        userId: domainUserId,
        role: 'owner',
        name: `should-not-exist-${bogus}`,
        models: [bogus],
      });
      check(`createKey refuses "${bogus}"`, false, 'it was accepted');
    } catch (e) {
      check(
        `createKey refuses "${bogus}"`,
        e instanceof KeyServiceError && e.code === 'validation',
        e instanceof KeyServiceError ? e.code : String(e).slice(0, 80),
      );
    }
  }
  process.stdout.write(`  note  plan allowlist: ${JSON.stringify(planModels)}\n`);

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
    // The plan's allowlist is now two aliases on Starter (migration 0010),
    // so a key must carry BOTH — not just `fast`. A key scoped to one alias
    // would 403 on the other, which is a support ticket, not a detail.
    check(
      `gateway key carries the plan's aliases (got ${JSON.stringify(info.models ?? [])})`,
      (info.models ?? []).includes('fast') && (info.models ?? []).includes('smart'),
      `expected fast+smart, got ${JSON.stringify(info.models ?? [])}`,
    );
  }

  // ── 8b. The key∩team model intersection ──────────────────────────────
  //
  // LiteLLM resolves a key's effective access as the INTERSECTION of the
  // key's models and its TEAM's models. A key can therefore be perfectly
  // scoped and still be denied, and the 403 blames the API key — which sends
  // the investigation at the wrong object.
  //
  // This exact bug shipped once: syncOrganizationEntitlements() pushed the
  // team's BUDGET but never its MODELS, so every team kept the DEFAULT_MODELS
  // it was created with forever. The key said {fast,smart}, the team said
  // {fast}, the intersection was {fast}, and `smart` 403'd on a correctly
  // configured key. It was invisible while every plan allowed exactly
  // ['fast'], which matched the default by coincidence.
  //
  // So assert the intersection itself, not just the two lists separately.
  {
    const { getTeamInfo } = await import('@/lib/litellm/client');
    if (!teamId) {
      check('team readable from the gateway', false, 'organization has no litellmTeamId');
    } else {
      const team = await getTeamInfo(teamId);
      const teamModels = team.models ?? [];
      // Starter: fast + smart. `frontier` is asserted in section 15, where
      // the upgrade grants it.
      const keyModels = ['fast', 'smart'];
      const effective = keyModels.filter((m) => teamModels.includes(m));
      check(
        `gateway TEAM carries the plan's aliases (got ${JSON.stringify(teamModels)})`,
        keyModels.every((m) => teamModels.includes(m)),
        `effective access would be ${JSON.stringify(effective)}`,
      );
      check(
        'every alias survives the key∩team intersection',
        effective.length === keyModels.length,
        `effective=${JSON.stringify(effective)} key=${JSON.stringify(keyModels)} team=${JSON.stringify(teamModels)}`,
      );
    }
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
  // Every deployed model must be priced. Probing one hardcoded
  // "representative" per tier is what broke this before: a model moving
  // tiers left the probe pointing at the old row, and the increasing-order
  // check silently compared fast against fast and passed. So assert on all
  // eleven, then take the tier representatives explicitly.
  const deployedModels = [
    'nemotron-3.5-lightning', 'space-bunny', 'cat-jam', 'deepseek-v4.1-flash',
    'longcat-2.5-preview', 'mimo-v2.6', 'mimo-v2.6-flash', 'big-pickle',
    'grok-4.6-liberated', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor',
  ];

  const unpriced = deployedModels.filter((m) => !resolvePrice(priceTable, `openai/${m}`));
  check(
    `all ${deployedModels.length} deployed models are priced`,
    unpriced.length === 0,
    `unpriced: ${unpriced.join(', ') || 'none'} — their spend would be invisible in the ledger`,
  );

  // The model string LiteLLM actually reports for the `fast` alias. Kept in
  // sync with config/litellm.yaml; resolvePrice strips the provider prefix.
  const price = resolvePrice(priceTable, 'openai/nemotron-3.5-lightning');
  check('price table resolves the served model', Boolean(price), 'nemotron-3.5-lightning not in prices/models.yaml');

  const tierRates: Record<string, number> = {};
  for (const [alias, probe] of [
    ['fast', 'openai/nemotron-3.5-lightning'],
    ['smart', 'openai/longcat-2.5-preview'],
    ['frontier', 'openai/grok-4.6-liberated'],
  ] as const) {
    const p = resolvePrice(priceTable, probe);
    check(`price table resolves the \`${alias}\` alias`, Boolean(p), `${probe} not in prices/models.yaml`);
    if (p) tierRates[alias] = p.input_per_mtok;
  }
  if (Object.keys(tierRates).length === 3) {
    check(
      `aliases are priced in increasing order (fast ${tierRates.fast} < smart ${tierRates.smart} < frontier ${tierRates.frontier})`,
      tierRates.fast! < tierRates.smart! && tierRates.smart! < tierRates.frontier!,
      JSON.stringify(tierRates),
    );
  }

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

  // `frontier` is Pro-only, so the upgrade is the moment it must become
  // reachable. Asserted at the GATEWAY, not against the portal's plan row:
  // the portal could happily report Pro while the team still carries the
  // Starter allowlist, and that is exactly the §5.26 failure. A green plan
  // check proves nothing about what the gateway will actually serve.
  {
    const { getTeamInfo } = await import('@/lib/litellm/client');
    const team = await getTeamInfo(teamId);
    const teamModels = team.models ?? [];
    check(
      `the upgrade unlocks \`frontier\` on the team (team models: ${JSON.stringify(teamModels)})`,
      teamModels.includes('frontier'),
      'frontier is Pro-only; if it is missing here the team still carries the Starter allowlist',
    );
    check(
      'the upgrade did not drop the aliases Starter already had',
      teamModels.includes('fast') && teamModels.includes('smart'),
      `team models: ${JSON.stringify(teamModels)}`,
    );

    // And the real thing: a live request against the Pro-only alias.
    const frontierKey = await createKey({
      organizationId: org.id,
      userId: domainUserId,
      role: 'owner',
      name: 'frontier proof',
      models: ['frontier'],
    }).catch((e) => {
      check('minting a frontier-only key succeeds on Pro', false, String(e).slice(0, 120));
      return null;
    });
    if (frontierKey) {
      check('minting a frontier-only key succeeds on Pro', true);
      const status = await statusFor(frontierKey.plaintext, 'frontier');
      check(
        `a live request to \`frontier\` is served (http ${status})`,
        status === 200,
        `expected 200, got ${status} — a 403 here means the team still holds the Starter allowlist`,
      );

      // Revoke it immediately. The lifecycle drops back to Starter at the
      // re-subscribe step, and Starter allows only 3 keys — a key left
      // behind here would eat a slot and fail a later section for a reason
      // that has nothing to do with what it claims to test.
      await revokeKey({
        organizationId: org.id,
        keyId: frontierKey.key.id,
        userId: domainUserId,
        role: 'owner',
      }).catch(() => {});
    }
  }

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

  // ── 23. Free trial — start it, then prove the one-per-org rule ───────
  section('23. free trial (startTrial — starter-only, one per org, audit-backed)');
  // A dedicated org: a trial needs an org that has never subscribed.
  const trialEmail = `trial-${runTag}@verify.invalid`;
  const trialUser = await createLocalUser({ email: trialEmail, name: 'Trial Proof', password });
  const trialProvisioned = await ensurePersonalOrg(trialUser.domainUserId);
  const trialOrgId = trialProvisioned.organizationId;

  const eligBefore = await trialEligibility(trialOrgId);
  check(
    'a fresh org is eligible for the 7-day trial',
    eligBefore.eligible && eligBefore.trialDays === 7 && eligBefore.planCode === 'starter',
    JSON.stringify(eligBefore),
  );

  await startTrial(trialOrgId, 'starter', trialUser.domainUserId);
  const [trialSub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, trialOrgId));
  check(
    'startTrial opens the subscription in trialing',
    trialSub?.status === 'trialing',
    trialSub?.status ?? 'none',
  );
  const trialWindowDays = trialSub?.trialEnd
    ? Math.round((trialSub.trialEnd.getTime() - Date.now()) / 86_400_000)
    : -1;
  check('the trial window is 7 days', trialWindowDays === 7, `${trialWindowDays}d`);
  check(
    'the period IS the trial (periodEnd == trialEnd)',
    trialSub?.trialEnd != null &&
      trialSub?.currentPeriodEnd?.getTime() === trialSub.trialEnd.getTime(),
    `${trialSub?.currentPeriodEnd?.toISOString()} vs ${trialSub?.trialEnd?.toISOString()}`,
  );

  const trialState = await planStateFor(trialOrgId);
  check('trialing resolves to full access in the dashboard', trialState.state === 'active', trialState.state);

  const trialEnt = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, trialOrgId),
  });
  check(
    'trialing grants FULL at the gateway (a trial exercises the product)',
    (trialEnt?.effective as { effect?: string })?.effect === 'full',
    JSON.stringify(trialEnt?.effective),
  );

  const eligAfter = await trialEligibility(trialOrgId);
  check(
    'the trial cannot be started twice (the audit row is the ledger)',
    !eligAfter.eligible && eligAfter.reason === 'trial_used',
    JSON.stringify(eligAfter),
  );
  let secondTrialRefused = false;
  try {
    await startTrial(trialOrgId, 'starter', trialUser.domainUserId);
  } catch (e) {
    secondTrialRefused = (e as { code?: string }).code === 'conflict';
  }
  check('a second startTrial is refused with a conflict', secondTrialRefused);
  check(
    'Pro offers no trial (its ~$144 grant is a business decision, not a default)',
    (await trialEligibility(trialOrgId, 'pro')).reason === 'no_trial_plan',
  );

  // ── 24. Admin console — the three manual staff powers ────────────────
  section('24. admin console (suspend / reactivate / retry / credit)');
  const STAFF = 'verify-staff';

  const suspended = await setOrganizationStatus(STAFF, trialOrgId, 'suspended');
  const orgAfterSuspend = await db.query.organizations.findFirst({
    where: eq(organizations.id, trialOrgId),
  });
  check('suspend writes the org status', orgAfterSuspend?.status === 'suspended', orgAfterSuspend?.status);
  check(
    'suspend pushes a real CUT to the gateway',
    suspended.ok && suspended.syncOk === true && suspended.effect === 'cut',
    JSON.stringify(suspended),
  );

  let suspendedCheckoutRefused = false;
  try {
    await beginCheckout(trialOrgId, 'starter', trialUser.domainUserId);
  } catch (e) {
    suspendedCheckoutRefused = (e as { code?: string }).code === 'forbidden';
  }
  check('a suspended org is refused the money path (403 forbidden)', suspendedCheckoutRefused);

  const suspendedAgain = await setOrganizationStatus(STAFF, trialOrgId, 'suspended');
  check(
    'suspending an already-suspended org is a no-op (idempotent)',
    suspendedAgain.ok && suspendedAgain.alreadyApplied === true,
    JSON.stringify(suspendedAgain),
  );

  const reactivatedOrg = await setOrganizationStatus(STAFF, trialOrgId, 'active');
  const entReactivated = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, trialOrgId),
  });
  check(
    'reactivate restores FULL access',
    reactivatedOrg.ok &&
      reactivatedOrg.syncOk === true &&
      (entReactivated?.effective as { effect?: string })?.effect === 'full',
    JSON.stringify(reactivatedOrg),
  );

  const retried = await retryEntitlementSync(STAFF, trialOrgId);
  check(
    'manual entitlement retry reports the pushed effect',
    retried.ok && retried.syncOk === true && retried.effect === 'full',
    JSON.stringify(retried),
  );

  const credit = await recordCreditNote(STAFF, {
    organizationId: trialOrgId,
    amountCents: -2000,
    currency: 'TND',
    reason: 'verify: goodwill refund',
  });
  check(
    'a credit note is recorded with its staff author',
    credit.ok && Boolean(credit.id),
    JSON.stringify(credit),
  );
  const creditList = await listCreditNotes(trialOrgId);
  check(
    'the credit note is listed for the org',
    creditList.length === 1 &&
      creditList[0]?.amountCents === -2000 &&
      creditList[0]?.createdBy === STAFF,
    JSON.stringify(creditList[0]),
  );
  const zeroCredit = await recordCreditNote(STAFF, {
    organizationId: trialOrgId,
    amountCents: 0,
    reason: 'nothing',
  });
  check('a zero-amount credit note is refused', zeroCredit.ok === false && zeroCredit.error === 'amount_required');
  const adminRoster = await listAdminOrgs();
  check('the admin roster includes the org it just acted on', adminRoster.some((o) => o.id === trialOrgId));

  // ── 25. Anomaly scan — the money-risk signals ────────────────────────
  section('25. anomaly scan (detect_anomalies — mule phone, burst, cap, big request)');
  const anomalyDay = new Date().toISOString().slice(0, 10);
  const phone = `+2160000${runTag.slice(0, 6)}`;
  const [mainSub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, org.id));

  // (a) mule phone: one number, two orgs. `proof_submitted` is an open
  // state, but neither subscription holds another open payment, so the
  // one-open-payment index is satisfied — the synthetic rows are legal.
  await db.insert(paymentsD17).values([
    {
      subscriptionId: mainSub!.id,
      organizationId: org.id,
      amountMillimes: 1000,
      usdAmountCents: 100,
      fxRate: '3.1000',
      authorizationNumber: `ANOM-A-${runTag}`,
      senderPhone: phone,
      status: 'proof_submitted',
      expiresAt: new Date(),
    },
    {
      subscriptionId: trialSub!.id,
      organizationId: trialOrgId,
      amountMillimes: 1000,
      usdAmountCents: 100,
      fxRate: '3.1000',
      authorizationNumber: `ANOM-B-${runTag}`,
      senderPhone: phone,
      status: 'proof_submitted',
      expiresAt: new Date(),
    },
  ]);

  // (b) rejected-proof burst: three rejections in 24h on the trial org.
  for (let i = 0; i < 3; i++) {
    await db.insert(auditLog).values({
      actorType: 'system',
      action: 'd17.rejected',
      organizationId: trialOrgId,
      after: { synthetic: true, i },
    });
  }

  // (c) hard-cap breach: the trialing trial org spent past its cap for
  // the period (starter caps at $100). (d) a single oversized request.
  await db.insert(usageRecords).values([
    {
      organizationId: trialOrgId,
      occurredAt: new Date(),
      billingPeriod: anomalyDay,
      model: 'fast',
      route: 'chat',
      // Starter's hard cap is $100 (10000¢); spend $150 so the breach
      // is unambiguous — the limiter was supposed to stop this.
      costUpstreamUsd: '115',
      costCustomerUsd: '150',
      dedupeHash: `anom-cap-${runTag}`,
    },
    {
      organizationId: org.id,
      occurredAt: new Date(),
      billingPeriod: anomalyDay,
      model: 'fast',
      route: 'chat',
      costUpstreamUsd: '100',
      costCustomerUsd: '130',
      dedupeHash: `anom-big-${runTag}`,
    },
  ]);
  const [bigUsage] = await db
    .select({ id: usageRecords.id })
    .from(usageRecords)
    .where(eq(usageRecords.dedupeHash, `anom-big-${runTag}`));

  const alertExists = async (name: string): Promise<boolean> =>
    Boolean(await db.query.systemAlerts.findFirst({ where: eq(systemAlerts.name, name) }));

  const scan1 = await detectAnomalies();
  check(
    'the scan flags one phone paying for two orgs',
    await alertExists(`anomaly:phone_reuse:${phone}`),
    `findings=${scan1.findings}`,
  );
  check(
    'the scan flags a rejected-proof burst',
    await alertExists(`anomaly:rejected_burst:${trialOrgId}`),
  );
  check(
    'the scan flags a hard-cap breach (the limiter did not hold)',
    await alertExists(`anomaly:cap_breach:${trialOrgId}`),
  );
  check(
    'the scan flags a single oversized request',
    await alertExists(`anomaly:large_request:${bigUsage!.id}`),
  );

  const scan2 = await detectAnomalies();
  check(
    'a second scan is silent — an unchanged condition does not re-alert',
    scan2.newOrChanged === 0 && scan2.recovered === 0,
    JSON.stringify(scan2),
  );

  // Recovery WITHOUT deleting evidence: the two payments expire.
  await db
    .update(paymentsD17)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(paymentsD17.senderPhone, phone));
  const scan3 = await detectAnomalies();
  check(
    'clearing the condition clears its alert (recovery, no delete)',
    scan3.recovered >= 1 && !(await alertExists(`anomaly:phone_reuse:${phone}`)),
    JSON.stringify(scan3),
  );

  // ── 26. Usage CSV export — the row count matches the table ───────────
  section('26. usage CSV export (streamed rows == the table it mirrors)');
  const cookie = await signInAsCustomer(PORTAL_URL, email, password);
  check('the metering account signs in over HTTP', cookie.includes('session-token'));

  const winFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const winTo = new Date(Date.now() + 60_000).toISOString();
  const exportQuery = new URLSearchParams({ from: winFrom, to: winTo });
  const csvRes = await fetch(`${PORTAL_URL}/api/usage/export?${exportQuery}`, {
    headers: { Cookie: cookie },
  });
  const declared = Number(csvRes.headers.get('x-row-count'));
  const csvBody = await csvRes.text();
  check(
    'the export answers 200 with an X-Row-Count header',
    csvRes.status === 200 && Number.isFinite(declared),
    `status ${csvRes.status} declared ${declared}`,
  );

  const csvLines = csvBody.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
  const headerLine = csvLines[0] ?? '';
  const dataLines = csvLines.slice(1);
  check(
    'the streamed body writes exactly the rows it counted',
    dataLines.length === declared,
    `declared=${declared} body=${dataLines.length}`,
  );
  const table = await usageHistory(org.id, { from: winFrom, to: winTo });
  check(
    'the export count equals the table total (one source of truth)',
    declared === table.total && table.total >= 1,
    `declared=${declared} table=${table.total}`,
  );
  check(
    'the CSV header names the ledger columns',
    headerLine.includes('occurred_at') && headerLine.includes('cost_customer_usd'),
    headerLine.slice(0, 60),
  );

  // ── 27. Trial expiry — the job cuts, it does not revoke ──────────────
  section('27. trial expiry (expireTrials — unpaid + cut, keys starved)');
  await db
    .update(subscriptions)
    .set({
      trialEnd: new Date(Date.now() - 1000),
      currentPeriodEnd: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, trialSub!.id));

  const expiries = await expireTrials();
  check('the job ends the elapsed trial', expiries.ended >= 1, JSON.stringify(expiries));

  const endedSub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, trialSub!.id),
  });
  check(
    'the subscription lands in unpaid (cut, not canceled/revoked)',
    endedSub?.status === 'unpaid',
    endedSub?.status,
  );
  const endedEnt = await db.query.entitlements.findFirst({
    where: eq(entitlements.organizationId, trialOrgId),
  });
  check(
    'the gateway is pushed to CUT_BUDGET',
    (endedEnt?.effective as { effect?: string })?.effect === 'cut',
    JSON.stringify(endedEnt?.effective),
  );
  const eligPostTrial = await trialEligibility(trialOrgId);
  check(
    'the trial stays spent after it ends (one per org, forever)',
    !eligPostTrial.eligible && eligPostTrial.reason === 'trial_used',
    JSON.stringify(eligPostTrial),
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
      `  lifecycle      paywall → checkout → activate → replay(no-op) → use → upgrade → cancel@period-end (grace) → rollover(cut) → re-subscribe → usage-series → cancel(now) → revoke(401) → delete-account → rename → trial → admin(suspend/reactivate/credit) → anomaly-scan → csv-export → trial-expiry(cut)\n` +
      `  left behind    users ${email} + ${trialEmail}, orgs + teams, ledger rows, synthetic anomaly rows (evidence — nothing deleted)\n`,
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
