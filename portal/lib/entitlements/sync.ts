/**
 * Entitlement sync — plan × subscription status → LiteLLM enforcement.
 *
 * This is the single writer of the `entitlements` table and the only thing
 * that pushes limits to the gateway. PLATFORM.md §5: "One function, one
 * writer, idempotent."
 *
 * Two properties are load-bearing and are the reason this file is shaped
 * the way it is:
 *
 *   1. CACHING BEFORE PUSHING. The intended state is written to
 *      `entitlements` BEFORE the gateway is touched, and marked `synced`
 *      only after every push succeeds. A dashboard must never claim a
 *      customer is starved while their key still works.
 *
 *   2. 0 IS NOT "DENY". LiteLLM's limiter reads a limit of 0 as
 *      "unlimited". Cutting access therefore means 0.000001. Writing 0
 *      grants unlimited access to a customer we meant to suspend — the
 *      most expensive possible bug in this system.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { entitlements, organizations, plans, subscriptions, auditLog } from '@/db/schema';
import { updateTeamBudget, updateTeamModels, updateKeyLimits, listTeamKeys } from '@/lib/litellm/client';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
import {
  CUT_BUDGET,
  effectForStatus,
  resolveBudgetUsd,
  resolvePromptLimits,
  type Effect,
} from '@/lib/entitlements/policy';
import { log } from '@/lib/log';

// The rules (CUT_BUDGET, STATUS_EFFECT, resolveBudgetUsd) live in
// ./policy — pure, importable without a database, unit-tested there.
// Re-exported so existing callers of sync.ts keep working.
export { CUT_BUDGET, STATUS_EFFECT, resolveBudgetUsd } from '@/lib/entitlements/policy';
export type { Effect } from '@/lib/entitlements/policy';

export interface SyncResult {
  ok: boolean;
  error?: string;
  effect: Effect;
  budgetUsd: number;
  keysSynced: number;
}

/**
 * The org's subscription, WHATEVER its status.
 *
 * The cut statuses (canceled, unpaid, incomplete) are deliberately NOT
 * in the `subscriptions_one_live_idx` predicate — that index guarantees
 * at most one LIVE row. But a cut has to be pushed through the normal
 * path (team AND every key) for it to actually take effect, so
 * resolving only live rows made cancellation unenforceable:
 * `cancelSubscription` flips the status to 'canceled', the sync then
 * found nothing to resolve, answered "no live subscription", and the
 * keys kept the old plan's budget. The money-path proof
 * (`make verify-metering`) is what caught it.
 *
 * The billing service keeps exactly one subscription row per org for
 * its lifetime (mutated in place), so "the row" is unambiguous here.
 * For legacy multi-row orgs, prefer a live row, then the most recently
 * updated — never a canceled row over an active one.
 */
async function resolveSubscription(orgId: string) {
  const rows = (await db.execute(sql`
    SELECT s.id, s.status, p.id AS plan_id, p.code AS plan_code,
           p.included_spend_cents, p.hard_cap_cents, p.rpm_limit,
           p.tpm_limit, p.max_concurrent_requests, p.models,
           p.max_keys, p.max_seats, p.rate_multiplier_bps, p.trial_days,
           p.prompt_limits
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ${orgId}
     ORDER BY (s.status IN ('active','past_due','paused')) DESC,
              s.updated_at DESC
     LIMIT 1
  `)) as unknown as {
    id: string; status: string; plan_id: string; plan_code: string;
    included_spend_cents: number; hard_cap_cents: number | null;
    rpm_limit: number | null; tpm_limit: number | null;
    max_concurrent_requests: number | null; models: string[];
    max_keys: number; max_seats: number; rate_multiplier_bps: number;
    trial_days: number; prompt_limits: unknown;
  }[];
  return rows[0] ?? null;
}

export interface EntitlementSpec {
  effect: Effect;
  planCode: string;
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null;
  models: string[];
  maxKeys: number;
  maxSeats: number;
  maxBudgetUsd: number;
  budgetDuration: string;
  /** Per-alias prompt limits for the current billing period. Migration 0013. */
  promptLimits: Record<string, number>;
}

/**
 * Push an org's entitlement to the gateway.
 *
 * Idempotent: calling it repeatedly with the same inputs converges on the
 * same state, which is what makes the 1-hour reconcile job safe and what
 * makes a webhook replay harmless.
 */
export async function syncOrganizationEntitlements(
  organizationId: string,
  reason: string,
): Promise<SyncResult> {
  const live = await resolveSubscription(organizationId);
  if (!live) {
    // No subscription row at all — the paywall state of a brand-new
    // account. Cut anything the gateway still has, and stop: there is
    // no plan to cache an entitlement against (`entitlements.plan_id`
    // is NOT NULL), so the ABSENCE of the row is the dashboard's
    // signal, and the reconciler iterates entitlement rows, not orgs,
    // so it will not spin on this.
    await forceCut(organizationId, reason, 'no subscription');
    return { ok: false, error: 'no subscription', effect: 'cut', budgetUsd: CUT_BUDGET, keysSynced: 0 };
  }

  // Fetch the org once, BEFORE deciding the effect. Suspension is an
  // account-level gate, not a subscription state: a suspended org is cut
  // no matter how healthy its subscription looks. Doing this after the
  // push (the old shape) would have pushed full limits onto an org staff
  // had just suspended — the exact drift the reconciler exists to catch.
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  const suspended = org !== undefined && org !== null && org.status !== 'active';

  const effect: Effect = suspended ? 'cut' : effectForStatus(live.status);
  const budgetUsd = resolveBudgetUsd(
    {
      includedSpendCents: live.included_spend_cents,
      hardCapCents: live.hard_cap_cents,
      rateMultiplierBps: live.rate_multiplier_bps,
      planCode: live.plan_code,
    },
    effect,
  );

  const promptLimits = resolvePromptLimits(
    { promptLimits: live.prompt_limits as Record<string, number> | null },
    effect,
  );

  // ── THE QUOTA WALL. Same helper enforce() uses: allowed = entitled
  // WHERE used < limit in the current window. Sync used to push the full
  // plan list, resurrecting every alias enforce had just narrowed — the
  // leak this fix closes. Reconcile hourly now re-pushes the NARROWED
  // list, never the full one. Renewal restores: a new window has zero
  // usage so the wall re-allows everything.
  let allowedModels: string[];
  let quotaUsedBy: Record<string, number> = {};
  if (effect === 'cut') {
    allowedModels = [];
  } else if (suspended) {
    // Suspended reads as cut for the push even when the subscription is
    // live — but quota usage is still reported for the cached spec.
    allowedModels = [];
  } else {
    try {
      const wall = await getAllowedModels(organizationId);
      allowedModels = wall.allowed;
      quotaUsedBy = wall.usedBy;
    } catch (e) {
      // Fail CLOSED on a wall read error: pushing the full list would grant
      // quota that may already be exhausted. The sync fails, stays pending,
      // and the retry queue re-attempts.
      const message = `quota wall unreadable: ${e instanceof Error ? e.message : String(e)}`;
      await db.update(entitlements)
        .set({ status: 'failed', lastError: message })
        .where(eq(entitlements.organizationId, organizationId));
      log.error('entitlement sync failed', { organizationId, reason, error: message });
      return { ok: false, error: message, effect, budgetUsd, keysSynced: 0 };
    }
  }

  const spec: EntitlementSpec = {
    effect,
    planCode: live.plan_code,
    rpm: effect === 'cut' ? null : live.rpm_limit,
    tpm: effect === 'cut' ? null : live.tpm_limit,
    concurrency: effect === 'cut' ? null : live.max_concurrent_requests,
    models: allowedModels,
    maxKeys: live.max_keys,
    maxSeats: live.max_seats,
    maxBudgetUsd: budgetUsd,
    budgetDuration: '30d',
    promptLimits,
  };

  // ── 1. Cache the intended state FIRST, so the dashboard is correct
  //       even if the gateway is unreachable.
  await db.insert(entitlements)
    .values({
      organizationId,
      planId: live.plan_id,
      planCode: live.plan_code,
      effective: spec as unknown as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
    })
    .onConflictDoUpdate({
      target: entitlements.organizationId,
      set: {
        planId: live.plan_id,
        planCode: live.plan_code,
        effective: spec as unknown as Record<string, unknown>,
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });

  const failures: string[] = [];
  let keysSynced = 0;

  // ── 2. Push down. Every key individually — a partial failure must not
  //       leave one key on an old plan while its siblings moved.
  // `allowedModels` is the QUOTA-NARROWED list (same wall enforce uses),
  // NOT the full plan list — pushing the full list is the leak that let
  // over-limit aliases keep serving. `[]` = deny all when every alias is
  // exhausted; verified via forceCut, which already pushes [] for cut orgs.
  if (org?.litellmTeamId) {
    try {
      await updateTeamBudget(org.litellmTeamId, {
        maxBudgetUsd: budgetUsd,
        budgetDuration: spec.budgetDuration,
      });
    } catch (e) {
      failures.push(`team ${org.litellmTeamId}: ${String(e)}`);
    }

    // The team's OWN model list, which was missing here and is load-bearing.
    //
    // LiteLLM resolves a key's effective access as the intersection of the
    // key's models and its team's models. A team is created once, with
    // DEFAULT_MODELS, and never had its models pushed again — so the team
    // stayed at that original list forever. Every key inherited it, and a key
    // minted for a WIDER plan silently lost those models: the key said
    // {fast, smart, frontier}, the team said {fast}, the intersection was
    // {fast} — and the request 403'd with a message that blames the
    // credential rather than the team. (HANDOFF.md §5.26.)
    //
    // This stayed invisible while every plan allowed exactly ['fast'], which
    // matched DEFAULT_MODELS by coincidence. It surfaced the moment migration
    // 0010 widened a plan allowlist past what the team was born with. The
    // push below is what keeps the team's list from ever being the narrower
    // of the two, so the intersection is decided by the plan alone.
    try {
      await updateTeamModels(org.litellmTeamId, allowedModels);
    } catch (e) {
      failures.push(`team ${org.litellmTeamId} models: ${String(e)}`);
    }

    const keys = await listTeamKeys(org.litellmTeamId);
    for (const k of keys) {
      try {
        // k.token — LiteLLM's token id. The display mask ("sk-...")
        // answers 404 and would mark every org's sync failed.
        await updateKeyLimits(k.token, {
          models: allowedModels,
          maxBudget: budgetUsd,
          budgetDuration: spec.budgetDuration,
          // Only prompt count limits (enforced by the desktop app) gate
          // usage. Token budgets, rpm and tpm are set to null/unlimited so
          // LiteLLM never blocks a request before the prompt limit kicks in.
          rpmLimit: null,
          tpmLimit: null,
          maxParallelRequests: spec.concurrency,
        });
        keysSynced++;
      } catch (e) {
        failures.push(`key ${k.token}: ${String(e)}`);
      }
    }
  }

  // ── 3. Record the outcome. `synced` only when everything landed.
  if (failures.length) {
    const message = failures.join('; ');
    await db.update(entitlements)
      .set({ status: 'failed', lastError: message })
      .where(eq(entitlements.organizationId, organizationId));

    log.error('entitlement sync failed', { organizationId, reason, error: message });
    return { ok: false, error: message, effect, budgetUsd, keysSynced };
  }

  await db.update(entitlements)
    .set({ status: 'synced', syncedAt: new Date(), lastError: null })
    .where(eq(entitlements.organizationId, organizationId));

  await db.insert(auditLog).values({
    actorType: 'system',
    action: 'entitlements.synced',
    organizationId,
    after: { effect, reason, plan: live.plan_code, budgetUsd, keysSynced, suspended, allowedModels, quotaUsedBy },
  });

  return { ok: true, effect, budgetUsd, keysSynced };
}

/**
 * Cut access for an org with no resolvable subscription row.
 *
 * Separate from the main path because it must work when the
 * subscription rows are missing or inconsistent entirely (an org
 * suspended by staff, or one at the paywall). Team AND keys: a team-only
 * cut leaves any minted key spending under its own budget, which for
 * this path means a leftover credential on a deleted plan.
 */
async function forceCut(organizationId: string, reason: string, error: string): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!org?.litellmTeamId) return;

  const failures: string[] = [];

  try {
    await updateTeamBudget(org.litellmTeamId, {
      maxBudgetUsd: CUT_BUDGET,
      budgetDuration: '30d',
    });
  } catch (e) {
    failures.push(`team: ${String(e)}`);
  }

  // Cut the TEAM's models too, not just each key's. The key-level cut alone
  // is sufficient to deny access — effective access is the intersection, so
  // an empty key list denies everything — but leaving the team carrying a
  // live model list means a key added out of band inherits access that no
  // entitlement backs. Re-subscribing restores it, because sync() now pushes
  // team models on the way up.
  try {
    await updateTeamModels(org.litellmTeamId, []);
  } catch (e) {
    failures.push(`team models: ${String(e)}`);
  }

  for (const k of await listTeamKeys(org.litellmTeamId)) {
    try {
      await updateKeyLimits(k.token, {
        models: [],
        maxBudget: CUT_BUDGET,
        budgetDuration: '30d',
        rpmLimit: null,
        tpmLimit: null,
        maxParallelRequests: null,
      });
    } catch (e) {
      failures.push(`key ${k.token}: ${String(e)}`);
    }
  }

  await db.insert(auditLog).values({
    actorType: 'system',
    action: 'entitlements.cut',
    organizationId,
    after: { reason, error, budgetUsd: CUT_BUDGET },
  });

  if (failures.length) {
    log.error('force cut: some limits could not be pushed', { organizationId, error: failures.join('; ') });
  }
}