/**
 * Provision a campaign account: identity, org, trial subscription, API keys.
 *
 *   node --experimental-transform-types \
 *        --import ./scripts/register-ts-resolve.mjs \
 *        scripts/provision-trial-account.ts <<'JSON'
 *   [{"email":"...","company":"...","password":"...","keys":[...]}]
 *   JSON
 *
 * Reads one JSON array of accounts from stdin and prints one JSON array of
 * results to stdout, so the caller (outreach/provision.py) never has to parse
 * prose and never has to hold a credential in an argument list — argv is
 * visible in `ps` to every user on the box, stdin is not.
 *
 * WHAT IT GUARANTEES, and each of these is a thing a future editor will be
 * tempted to "simplify":
 *
 *   1. The account is VERIFIED. `createLocalUser({emailVerified:true})` stamps
 *      both auth_users.email_verified and the users mirror. Without it the
 *      redeem route's requireVerifiedEmail() rejects the very people this
 *      email was written for, and the email already says "use this account".
 *
 *   2. The subscription is a real `trial` row with a real `trial_end`.
 *      `grantPlan()` is the wrong call here: it writes a PAID interval, and
 *      the recipient would be on a plan they never bought, with no expiry job
 *      to cut it. The row inserted here is exactly what redeemTrialCode()
 *      writes — same plan, same status `trialing`, same daily_quota=false —
 *      so the hourly trial-expiry job cuts it at 72h like any other trial.
 *
 *   3. Entitlements are SYNCED. `syncOrganizationEntitlements` is what makes
 *      the gateway allow smart/frontier/fable instead of 403ing the alias on
 *      first call. A trial that exists only in Postgres is a broken trial.
 *
 *   4. IDEMPOTENT. Re-running for the same email RESUMES rather than
 *      duplicating: the identity is converged to the supplied password (so a
 *      re-run is also how you rotate a leaked one), the subscription is
 *      re-windowed to 72h from now, and only the keys MISSING by name are
 *      minted. That last rule is what makes a half-finished batch safe to
 *      rerun.
 *
 * It is NOT idempotent about the trial window in a way you should rely on:
 * re-running extends a live trial. Intended for provisioning, not upkeep.
 */
import './env.mjs';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db';
import {
  apiKeys,
  authCredentials,
  authUsers,
  organizations,
  plans,
  subscriptions,
  trialCodes,
  trialRedemptions,
  users,
} from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { hashPassword } from '@/lib/auth/password';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import { syncOrganizationEntitlements } from '@/lib/entitlements/sync';
import { createTeam } from '@/lib/litellm/client';
import { createKey } from '@/lib/keys/index';

const TRIAL_CODE = process.env.TRIAL_CODE ?? 'ZAINO-PARTNER-3D';

/** What a freshly created team may call before its plan is pushed. Same set
 *  ensurePersonalOrg() uses, so a repaired team is not distinguishable. */
const DEFAULT_MODELS = ['fast', 'smart', 'frontier'];
const TRIAL_HOURS = 72;

interface AccountInput {
  email: string;
  company: string;
  password: string;
  keys?: string[];
}

interface AccountResult {
  email: string;
  company: string;
  /** 'created' | 'resumed' | 'skipped' — skipped carries `error`. */
  status: 'created' | 'resumed' | 'skipped';
  orgId?: string;
  /** Plaintext, returned ONCE so the mailer can put it in the email. */
  keys?: string[];
  expiresAt?: string;
  error?: string;
}

const DEFAULT_KEY_NAMES = ['default'];

function normalise(input: AccountInput): AccountInput {
  return {
    email: input.email.trim().toLowerCase(),
    company: input.company.trim(),
    password: input.password,
    keys: input.keys?.length ? input.keys.map((k) => k.trim()).filter(Boolean) : DEFAULT_KEY_NAMES,
  };
}

/**
 * The identity, converged. Returns the DOMAIN user id (`users.id`), which is
 * the one every product table references — `auth_users.id` is a different
 * UUID and passing it to a membership FK violates the constraint.
 */
async function ensureIdentity(input: AccountInput): Promise<{
  domainUserId: string;
  created: boolean;
}> {
  const existing = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, input.email),
  });

  if (!existing) {
    const made = await createLocalUser({
      email: input.email,
      name: input.company,
      password: input.password,
      emailVerified: true,
    });
    return { domainUserId: made.domainUserId, created: true };
  }

  // Converge the password and re-stamp verification. A campaign account that
  // cannot sign in is worse than no account: the recipient reads "your
  // account is ready" and then cannot get past the login form.
  const hash = await hashPassword(input.password);
  const now = new Date();

  const mirror = await db.transaction(async (tx) => {
    await tx
      .insert(authCredentials)
      .values({ userId: existing.id, password: hash, updatedAt: now })
      .onConflictDoUpdate({
        target: authCredentials.userId,
        set: { password: hash, updatedAt: now },
      });

    await tx
      .update(authUsers)
      .set({ emailVerified: now, name: input.company })
      .where(eq(authUsers.id, existing.id));

    // UPDATE-then-INSERT, not upsert: `users` carries two unique keys
    // (email, and auth_provider+auth_id) and an upsert can only name one.
    const updated = await tx
      .update(users)
      .set({
        email: input.email,
        name: input.company,
        emailVerifiedAt: now,
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(and(eq(users.authProvider, 'authjs'), eq(users.authId, existing.id)))
      .returning({ id: users.id });

    if (updated[0]) return updated[0];

    const [inserted] = await tx
      .insert(users)
      .values({
        authProvider: 'authjs',
        authId: existing.id,
        email: input.email,
        name: input.company,
        emailVerifiedAt: now,
        passwordChangedAt: now,
      })
      .returning({ id: users.id });

    if (!inserted) throw new Error('provision: domain mirror insert returned no row');
    return inserted;
  });

  return { domainUserId: mirror.id, created: false };
}

/** The `trial` plan row, and the code row the provisioning is attributed to. */
async function loadGrant(): Promise<{
  planId: string;
  codeId: string;
  /**
   * The plan's model allowlist, read from the row rather than hardcoded —
   * 0049 sets it to smart/frontier/fable and a stale literal here would mint
   * keys for an alias the plan does not grant.
   */
  models: string[];
}> {
  const [plan] = await db
    .select({ id: plans.id, models: plans.models })
    .from(plans)
    .where(eq(plans.code, 'trial'))
    .limit(1);
  if (!plan) throw new Error('the hidden `trial` plan row is missing — run make db-migrate');
  if (!plan.models?.length) throw new Error('the trial plan grants no models');

  const [code] = await db
    .select({ id: trialCodes.id })
    .from(trialCodes)
    .where(and(eq(trialCodes.code, TRIAL_CODE), eq(trialCodes.active, true)))
    .limit(1);

  // The code row is attribution, not enforcement (0049). Required anyway:
  // without it the redemption has no `created_by` story and the campaign's
  // count is invisible in the console.
  if (!code) throw new Error(`${TRIAL_CODE} is missing or inactive`);

  return { planId: plan.id, codeId: code.id, models: plan.models };
}

/**
 * Create the org's gateway team if it never got one. Returns false only when
 * the org still has no team afterwards, which the caller must treat as
 * failure: minting a key against a team-less org is exactly what
 * createApiKey() refuses, and it is right to.
 */
async function attachTeamIfMissing(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ slug: organizations.slug, litellmTeamId: organizations.litellmTeamId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw new Error(`organization ${orgId} vanished`);
  if (org.litellmTeamId) return true;

  try {
    const team = await createTeam({
      teamAlias: org.slug,
      // Same placeholder every provisioned org starts at — the sync that
      // follows raises it to the plan's real ceiling.
      maxBudgetUsd: CUT_BUDGET,
      budgetDuration: '30d',
      models: DEFAULT_MODELS,
    });
    await db
      .update(organizations)
      .set({ litellmTeamId: team.team_id, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
    return true;
  } catch (e) {
    console.error(`WARN ${orgId}: team re-creation failed — ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/**
 * Exactly the write redeemTrialCode() makes, minus the code-validation step
 * (the caller is us). `daily_quota: false` is load-bearing: 0038 measured the
 * trial over its own 3-day window, and a true here would re-grant the whole
 * allowance every Tunis day instead.
 */
async function attachTrial(input: {
  orgId: string;
  domainUserId: string;
  planId: string;
  codeId: string;
  hours: number;
}): Promise<Date> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.hours * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, input.orgId))
      .limit(1);

    let subscriptionId: string;
    if (existing) {
      await tx
        .update(subscriptions)
        .set({
          planId: input.planId,
          status: 'trialing',
          trialEnd: expiresAt,
          currentPeriodStart: now,
          currentPeriodEnd: expiresAt,
          cancelAtPeriodEnd: false,
          dailyQuota: false,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existing.id));
      subscriptionId = existing.id;
    } else {
      const [inserted] = await tx
        .insert(subscriptions)
        .values({
          organizationId: input.orgId,
          planId: input.planId,
          status: 'trialing',
          trialEnd: expiresAt,
          currentPeriodStart: now,
          currentPeriodEnd: expiresAt,
          cancelAtPeriodEnd: false,
          dailyQuota: false,
        })
        .returning({ id: subscriptions.id });
      if (!inserted) throw new Error('provision: subscription insert returned no row');
      subscriptionId = inserted.id;
    }

    // One redemption row per (org, code); a resume must not mint a second,
    // or the campaign's redeemed_count double-counts the same org.
    const [prior] = await tx
      .select({ id: trialRedemptions.id })
      .from(trialRedemptions)
      .where(
        and(
          eq(trialRedemptions.organizationId, input.orgId),
          eq(trialRedemptions.trialCodeId, input.codeId),
        ),
      )
      .limit(1);

    if (prior) {
      await tx
        .update(trialRedemptions)
        .set({ subscriptionId, expiresAt })
        .where(eq(trialRedemptions.id, prior.id));
    } else {
      await tx.insert(trialRedemptions).values({
        trialCodeId: input.codeId,
        organizationId: input.orgId,
        userId: input.domainUserId,
        subscriptionId,
        expiresAt,
      });
      // Atomic increment, same statement redeemTrialCode() runs: two
      // provisioners in parallel must not read-modify-write the same count.
      await tx.execute(
        sql`UPDATE trial_codes SET redeemed_count = redeemed_count + 1 WHERE id = ${input.codeId}::uuid`,
      );
    }
  });

  return expiresAt;
}

async function provisionOne(raw: AccountInput): Promise<AccountResult> {
  const input = normalise(raw);
  const base: AccountResult = {
    email: input.email,
    company: input.company,
    status: 'skipped',
  };

  if (!input.email.includes('@')) return { ...base, error: 'not an email address' };
  if (!input.password) return { ...base, error: 'no password supplied' };

  const identity = await ensureIdentity(input);
  const grant = await loadGrant();

  // ensurePersonalOrg() also creates the LiteLLM team and stores its id; a
  // key minted before that exists is rejected by createApiKey ("not
  // connected to the gateway yet"), which is why the order matters.
  const org = await ensurePersonalOrg(identity.domainUserId);

  // ensurePersonalOrg() only creates a team when it also CREATES the org. On
  // a resume it returns early and never retries step 4, so an account whose
  // team creation failed the first time keeps `litellm_team_id = NULL` for
  // good — and sync.ts:231 silently skips an org with no team, so the hourly
  // reconciler cannot repair it either. Fix it here or not at all.
  if (org.liteLLMTeamError || !(await attachTeamIfMissing(org.organizationId))) {
    return {
      ...base,
      error: `gateway team missing: ${org.liteLLMTeamError ?? 'litellm_team_id is null and re-creation failed'}`,
    };
  }

  const expiresAt = await attachTrial({
    orgId: org.organizationId,
    domainUserId: identity.domainUserId,
    planId: grant.planId,
    codeId: grant.codeId,
    hours: TRIAL_HOURS,
  });

  const sync = await syncOrganizationEntitlements(org.organizationId, 'trial_provisioned');
  if (!sync.ok) {
    // Not fatal: the subscription is committed and the hourly reconciler
    // repairs the push. Reported because a silent failure here is a trial
    // whose keys 403 on the first request.
    console.error(`WARN ${input.email}: entitlement sync failed — ${sync.error}`);
  }

  // Mint only the keys that do NOT already exist by name. Re-running a
  // half-finished batch must not leave an org with duplicate keys.
  //
  // Read from the table, not listKeys(): that path makes one gateway
  // roundtrip per key to decorate the dashboard view, which this script has
  // no use for and would pay for on every resume.
  const have = new Set(
    (
      await db
        .select({ name: apiKeys.name })
        .from(apiKeys)
        .where(and(eq(apiKeys.organizationId, org.organizationId), isNull(apiKeys.revokedAt)))
    ).map((r) => r.name),
  );

  const plaintexts: string[] = [];
  for (const name of input.keys ?? DEFAULT_KEY_NAMES) {
    if (have.has(name)) continue;
    const made = await createKey({
      organizationId: org.organizationId,
      userId: identity.domainUserId,
      role: 'owner',
      name,
      // Explicitly the plan's allowlist, as the dashboard's create form sends
      // it, so the key is indistinguishable from one the customer made.
      models: grant.models,
    });
    plaintexts.push(made.plaintext);
  }

  return {
    ...base,
    status: identity.created ? 'created' : 'resumed',
    orgId: org.organizationId,
    keys: plaintexts,
    expiresAt: expiresAt.toISOString(),
  };
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    console.error('FATAL: expected a JSON array of accounts on stdin');
    process.exit(1);
  }

  let accounts: AccountInput[];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    accounts = parsed as AccountInput[];
  } catch (e) {
    console.error(`FATAL: stdin is not a JSON array of accounts — ${(e as Error).message}`);
    process.exit(1);
  }

  const results: AccountResult[] = [];
  for (const account of accounts) {
    try {
      results.push(await provisionOne(account));
    } catch (e) {
      results.push({
        email: account.email,
        company: account.company,
        status: 'skipped',
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  await pg.end();
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main().catch(async (e) => {
  console.error(`FATAL: ${(e as Error)?.message ?? e}`);
  await pg.end().catch(() => {});
  process.exit(1);
});
