/**
 * Provision comped Pro accounts for named people — identity, org, Pro grant.
 *
 *   docker compose run --rm --no-deps -T jobs \
 *     node --experimental-transform-types \
 *          --import ./scripts/register-ts-resolve.mjs \
 *          scripts/provision-pro-accounts.ts <<'JSON'
 *   [{"email":"...","name":"...","plan":"pro"}]
 *   JSON
 *
 * Add `-e SEND_RESET=1` to also mail each person a set-password link
 * through the app's own reset flow.
 *
 * WHY EACH STEP IS A CALL AND NOT AN INSERT.
 *
 *   1. `createLocalUser()` is the ONE code path that creates a user
 *      (lib/auth/create-user.ts): auth identity, scrypt credential and the
 *      domain `users` mirror commit together. An INSERT here would have to
 *      reproduce lib/auth/password.ts exactly; get it subtly wrong and the
 *      account exists, cannot sign in, and fails silently.
 *
 *   2. `ensurePersonalOrg()` is what the first authenticated request runs:
 *      it makes the org, the owner membership and the LiteLLM team. Granting
 *      a plan to an org that does not exist is not a thing.
 *
 *   3. `grantPlan()` is the same function behind the console's "grant plan"
 *      button. Writing `subscriptions` by hand changes what the dashboard
 *      says and nothing about what the gateway allows — the grant ends in
 *      `syncOrganizationEntitlements`, and a "Pro" account that still 403s
 *      is worse than no account.
 *
 * THE PASSWORD IS RANDOM AND NEVER LEAVES THE PROCESS. These people were
 * named, not handed a credential, so there is no password to agree on and
 * printing one would put it in a shell history, a CI log and this
 * transcript. A random 32-byte string satisfies validatePassword() and is
 * unusable by design: the way in is the reset link, which is the app's
 * normal recovery path (lib/auth/reset.ts — hashed token, 30-minute TTL,
 * single use) and which never passes a secret through the operator.
 *
 * IDEMPOTENT BY EMAIL. Re-running converges: an existing identity is left
 * signed-in-able, an existing org is reused, and the grant re-opens the
 * current period (periodFor), leaving one live subscription row — not two.
 */
import './env.mjs';

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { authUsers, organizations, plans, staffUsers, users } from '@/db/schema';
import { grantPlan } from '@/lib/admin/subscriptions';
import { createLocalUser } from '@/lib/auth/create-user';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import { requestPasswordReset } from '@/lib/auth/reset';

/** The audit actor previous comped grants were attributed to. */
const OPS_EMAIL = 'ops@zaino.ai';
const SEND_RESET = process.env.SEND_RESET === '1';

interface AccountInput {
  email: string;
  name: string;
  /** Plan code; defaults to `pro`. */
  plan?: string;
}

interface AccountResult {
  email: string;
  name: string;
  status: 'created' | 'existing';
  domainUserId?: string;
  orgId?: string;
  orgSlug?: string;
  plan?: string;
  periodEnd?: string;
  syncOk?: boolean;
  syncError?: string | null;
  /** False when the person already had a usable credential. */
  resetSent?: boolean;
  resetReason?: string;
  error?: string;
}

function randomPassword(): string {
  // base64url of 32 bytes: URL-safe, no shell metacharacters, and 43 chars
  // clears the 12-char floor in validatePassword() with room to spare.
  return randomBytes(32).toString('base64url');
}

/** The staff row the audit log points at. `audit_log.staff_id` is NOT NULL. */
async function opsStaffId(): Promise<string> {
  const existing = await db.query.staffUsers.findFirst({ where: eq(staffUsers.email, OPS_EMAIL) });
  if (existing) return existing.id;

  const [created] = await db
    .insert(staffUsers)
    .values({ email: OPS_EMAIL, name: 'Ops Grant', role: 'admin' })
    .onConflictDoNothing({ target: staffUsers.email })
    .returning({ id: staffUsers.id });
  if (created) return created.id;

  const again = await db.query.staffUsers.findFirst({ where: eq(staffUsers.email, OPS_EMAIL) });
  if (!again) throw new Error(`could not resolve the audit actor ${OPS_EMAIL}`);
  return again.id;
}

async function provision(input: AccountInput, staffId: string): Promise<AccountResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const planCode = (input.plan ?? 'pro').trim().toLowerCase();

  // ── 1. Identity. `createLocalUser` throws on a duplicate email, so the
  //      existence check is the idempotency gate, not a race guard here.
  const existing = await db.query.authUsers.findFirst({ where: eq(authUsers.email, email) });
  let domainUserId: string;
  let status: 'created' | 'existing';

  if (existing) {
    const mirror = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!mirror) {
      return { email, name, status: 'existing', error: 'auth identity exists with no domain mirror' };
    }
    domainUserId = mirror.id;
    status = 'existing';
  } else {
    const made = await createLocalUser({
      email,
      name,
      // These accounts exist to be used now. A local unverified account
      // cannot mint keys or check out, so leaving the flag off would hand
      // out three accounts that look fine and cannot do anything.
      emailVerified: true,
      password: randomPassword(),
    });
    domainUserId = made.domainUserId;
    status = 'created';
  }

  // ── 2. Org + owner membership + LiteLLM team.
  const org = await ensurePersonalOrg(domainUserId);

  // A team that failed to create leaves the org at the paywall with no
  // gateway linkage, so the grant below can commit and sync nothing. That
  // is worth failing loudly on, not reporting as success.
  if (org.liteLLMTeamError) {
    return {
      email, name, status, domainUserId, orgId: org.organizationId,
      error: `LiteLLM team creation failed: ${org.liteLLMTeamError}`,
    };
  }

  // ── 3. The plan, through the console's own path.
  const grant = await grantPlan(staffId, org.organizationId, planCode);
  if (!grant.ok) {
    return { email, name, status, domainUserId, orgId: org.organizationId, error: `grant failed: ${grant.error}` };
  }

  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, org.organizationId),
    columns: { slug: true },
  });

  // ── 4. The way in. Only for a NEW identity: an existing account has a
  //      credential its owner set, and mailing a reset would be an
  //      unrequested password change.
  let resetSent: boolean | undefined;
  let resetReason: string | undefined;
  if (SEND_RESET && status === 'created') {
    const reset = await requestPasswordReset(email);
    resetSent = reset.sent;
    resetReason = reset.reason;
  }

  return {
    email, name, status, domainUserId, orgId: org.organizationId,
    orgSlug: orgRow?.slug, plan: grant.planCode, periodEnd: grant.periodEnd,
    syncOk: grant.syncOk, syncError: grant.syncError,
    resetSent, resetReason,
  };
}

async function main() {
  const raw = await new Promise<string>((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });

  let inputs: AccountInput[];
  try {
    inputs = JSON.parse(raw);
  } catch (e) {
    console.error(`FATAL: stdin is not JSON — ${(e as Error).message}`);
    process.exit(1);
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    console.error('FATAL: expected a non-empty JSON array on stdin.');
    process.exit(1);
  }

  // Validate everything BEFORE writing anything: a batch that half-succeeds
  // because of a typo in row 3 is the state this script exists to avoid.
  const planCodes = [...new Set(inputs.map((i) => (i.plan ?? 'pro').trim().toLowerCase()))];
  const known = await db.select({ code: plans.code }).from(plans);
  const knownCodes = new Set(known.map((p) => p.code));
  for (const code of planCodes) {
    if (!knownCodes.has(code)) {
      console.error(`FATAL: no plan '${code}'. Known: ${[...knownCodes].join(', ')}`);
      process.exit(1);
    }
  }
  for (const [i, row] of inputs.entries()) {
    if (!row?.email?.includes('@')) {
      console.error(`FATAL: row ${i} has no usable email.`);
      process.exit(1);
    }
    if (!row?.name?.trim()) {
      console.error(`FATAL: row ${i} has no name.`);
      process.exit(1);
    }
  }

  const staffId = await opsStaffId();
  const results: AccountResult[] = [];
  for (const row of inputs) {
    try {
      results.push(await provision(row, staffId));
    } catch (e) {
      results.push({ email: row.email, name: row.name, status: 'created', error: (e as Error).message });
    }
  }

  // JSON on stdout, prose on stderr: the caller never has to parse prose.
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  for (const r of results) {
    const verdict = r.error
      ? `FAILED  ${r.error}`
      : `${r.syncOk ? 'live' : 'SYNC FAILED'}  ${r.plan} until ${r.periodEnd?.slice(0, 10)}  org=${r.orgSlug}`;
    const mail = r.resetSent === undefined ? '' : `  reset=${r.resetSent ? 'sent' : (r.resetReason ?? 'no')}`;
    console.error(`  ${r.status.padEnd(8)} ${r.email.padEnd(32)} ${verdict}${mail}`);
  }

  if (results.some((r) => r.error)) process.exit(2);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`FATAL: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  },
);
