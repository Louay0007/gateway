/**
 * Production KeyStore — Drizzle over the `portal` database.
 *
 * This is the ONLY file in lib/keys that touches our schema. It never
 * reads LiteLLM's database (PLATFORM.md §1.1): org → team mapping arrives
 * as `organizations.litellm_team_id` and everything else is REST.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  apiKeys,
  auditLog,
  entitlements,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
} from '@/db/schema';
import { effectForStatus, resolveBudgetUsd, type Effect } from '@/lib/entitlements/policy';
import type {
  KeyAuditEntry,
  KeyPlan,
  KeyRow,
  KeyStore,
  OrgForKeys,
} from '@/lib/keys/types';

/** Statuses that keep an org alive; mirrors `subscriptions_one_live_idx`. */
const LIVE_STATUSES = ['active', 'past_due', 'paused'] as const;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Rebuild a KeyPlan from the cached entitlement spec.
 *
 * `entitlements.effective` is written by syncOrganizationEntitlements()
 * and holds exactly the values that were pushed to the gateway. Reading
 * it means a key inherits the same ceiling the team's other keys have,
 * even mid-plan-change. Anything unparseable returns null and the caller
 * falls back to the subscription — a missing cache must degrade to
 * "compute it", never to "allow everything".
 */
function planFromEntitlement(
  row: { planId: string; planCode: string; effective: unknown },
): KeyPlan | null {
  const e = row.effective as Record<string, unknown> | null;
  if (!e || typeof e !== 'object') return null;

  const maxBudgetUsd = num(e.maxBudgetUsd);
  // A spec whose budget is missing or zero is not trustworthy: zero means
  // unlimited upstream, so refuse it rather than propagate it.
  if (maxBudgetUsd == null || maxBudgetUsd <= 0) return null;

  const models = Array.isArray(e.models)
    ? e.models.filter((m): m is string => typeof m === 'string')
    : null;
  if (models == null) return null;

  return {
    planId: row.planId,
    planCode: row.planCode,
    maxKeys: num(e.maxKeys) ?? 1,
    models,
    rpm: num(e.rpm),
    tpm: num(e.tpm),
    concurrency: num(e.concurrency),
    maxBudgetUsd,
    budgetDuration: typeof e.budgetDuration === 'string' ? e.budgetDuration : '30d',
    effect: e.effect === 'cut' ? 'cut' : ('full' satisfies Effect),
  };
}

export const store: KeyStore = {
  async orgWithTeam(organizationId): Promise<OrgForKeys | null> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    if (!org) return null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      litellmTeamId: org.litellmTeamId,
    };
  },

  async memberLiteLLMUserId(organizationId, userId): Promise<string | null> {
    const rows = await db
      .select({ litellmUserId: organizationMembers.litellmUserId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    return rows[0]?.litellmUserId ?? null;
  },

  async planForOrg(organizationId): Promise<KeyPlan | null> {
    const cached = await db.query.entitlements.findFirst({
      where: eq(entitlements.organizationId, organizationId),
    });
    if (cached) {
      const fromCache = planFromEntitlement(cached);
      if (fromCache) return fromCache;
    }

    // Fallback: derive from the live subscription. Same numbers
    // resolveBudgetUsd() would produce, so a freshly-provisioned org that
    // has not synced yet still gets a correct (and correctly zero) budget.
    const rows = await db
      .select({
        planId: plans.id,
        planCode: plans.code,
        models: plans.models,
        maxKeys: plans.maxKeys,
        rpm: plans.rpmLimit,
        tpm: plans.tpmLimit,
        concurrency: plans.maxConcurrentRequests,
        includedSpendCents: plans.includedSpendCents,
        hardCapCents: plans.hardCapCents,
        rateMultiplierBps: plans.rateMultiplierBps,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          inArray(subscriptions.status, [...LIVE_STATUSES]),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const effect = effectForStatus(row.status);
    return {
      planId: row.planId,
      planCode: row.planCode,
      maxKeys: row.maxKeys,
      models: row.models ?? [],
      rpm: row.rpm,
      tpm: row.tpm,
      concurrency: row.concurrency,
      maxBudgetUsd: resolveBudgetUsd(
        {
          includedSpendCents: row.includedSpendCents,
          hardCapCents: row.hardCapCents,
          rateMultiplierBps: row.rateMultiplierBps,
        },
        effect,
      ),
      budgetDuration: '30d',
      effect,
    };
  },

  async countActiveKeys(organizationId): Promise<number> {
    // Counted in SQL: revoking a key frees a slot immediately, so the
    // ceiling must be evaluated against unrevoked rows, not all rows.
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS n
        FROM api_keys
       WHERE organization_id = ${organizationId}::uuid
         AND revoked_at IS NULL
    `)) as unknown as { n: number }[];
    return rows[0]?.n ?? 0;
  },

  async insertKey(row): Promise<{ id: string }> {
    const [inserted] = await db
      .insert(apiKeys)
      .values({
        organizationId: row.organizationId,
        createdBy: row.createdBy,
        name: row.name,
        keyPrefix: row.keyPrefix,
        keyHash: row.keyHash,
        litellmKeyName: row.litellmKeyName,
        litellmKeyHash: row.litellmKeyHash,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      })
      .returning({ id: apiKeys.id });

    if (!inserted) throw new Error('insertKey returned no row');
    return { id: inserted.id };
  },

  async findKey(organizationId, keyId): Promise<KeyRow | null> {
    // Both predicates, always. A key id alone is not authorisation: this
    // is the tenant filter that keeps one org's key invisible to another.
    const row = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, organizationId)),
    });
    return row ?? null;
  },

  async markRevoked(keyId, at): Promise<void> {
    await db.update(apiKeys).set({ revokedAt: at }).where(eq(apiKeys.id, keyId));
  },

  async listActiveKeys(organizationId, limit): Promise<KeyRow[]> {
    return db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.organizationId, organizationId),
        isNull(apiKeys.revokedAt),
      ),
      orderBy: (fields, operators) => [operators.desc(fields.createdAt)],
      limit,
    });
  },

  async appendAudit(entry: KeyAuditEntry): Promise<void> {
    await db.insert(auditLog).values({
      actorType: 'user',
      actorId: entry.actorId,
      organizationId: entry.organizationId,
      action: entry.action,
      targetType: 'api_key',
      targetId: entry.targetId,
      after: entry.after,
    });
  },
};
