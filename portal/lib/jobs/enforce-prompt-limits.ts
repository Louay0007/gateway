/**
 * enforce_prompt_limits — server-side prompt quota enforcement.
 *
 * Rule: 1 successful inference request = 1 prompt. Plans cap prompts per
 * alias per subscription period (`plans.prompt_limits`). When an org has
 * used >= its limit on an alias, that alias is removed from the gateway
 * allowlist (team models + every key's models). When all entitled aliases
 * are exhausted, the allowlist becomes [] — every inference 403s.
 *
 * Why narrow models instead of setting a tiny budget: LiteLLM reads a
 * budget of 0 as UNLIMITED, and budget math is customer-vs-upstream
 * denomination-sensitive. The model allowlist is exact: no alias listed
 * means no inference on that alias, with zero denomination risk.
 *
 * Idempotent: recomputes from the ledger every pass. An org under quota
 * is re-synced to its full plan allowlist (self-healing after drift), an
 * org over quota is narrowed. Renewal restores automatically because usage
 * is windowed on the subscription period.
 *
 * Runs every 5 minutes beside collect_usage. Enforcement lags a collection
 * pass by design — quota is ledger truth, not gateway-cache truth.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  updateKeyLimits,
  updateTeamModels,
  listTeamKeys,
} from '@/lib/litellm/client';
import { log } from '@/lib/log';

export interface EnforcePromptLimitsResult {
  scanned: number;
  narrowed: number;
  restored: number;
  failed: number;
}

interface OrgPlan {
  organization_id: string;
  litellm_team_id: string | null;
  plan_code: string;
  models: string[];
  prompt_limits: Record<string, number>;
  period_start: string | null;
  period_end: string | null;
}

export async function enforcePromptLimits(): Promise<EnforcePromptLimitsResult> {
  const result: EnforcePromptLimitsResult = {
    scanned: 0,
    narrowed: 0,
    restored: 0,
    failed: 0,
  };

  // Live orgs with a live subscription and a team to push to.
  const orgs = (await db.execute(sql`
    SELECT o.id AS organization_id,
           o.litellm_team_id,
           p.code AS plan_code,
           p.models,
           COALESCE(p.prompt_limits, '{}'::jsonb) AS prompt_limits,
           s.current_period_start::text AS period_start,
           s.current_period_end::text AS period_end
      FROM organizations o
      JOIN subscriptions s ON s.organization_id = o.id
      JOIN plans p ON p.id = s.plan_id
     WHERE o.status = 'active'
       AND s.status IN ('active', 'trialing', 'past_due')
       AND o.litellm_team_id IS NOT NULL
  `)) as unknown as OrgPlan[];

  for (const org of orgs) {
    result.scanned++;
    try {
      const limits = (org.prompt_limits ?? {}) as Record<string, number>;
      // Window: subscription period when known, else trailing 30 days.
      const end = org.period_end ? new Date(org.period_end) : new Date();
      const start = org.period_start
        ? new Date(org.period_start)
        : new Date(end.getTime() - 30 * 86_400_000);

      const used = (await db.execute(sql`
        SELECT u.model, COALESCE(SUM(u.prompt_count), 0)::int AS prompts
          FROM usage_records u
         WHERE u.organization_id = ${org.organization_id}::uuid
           AND u.occurred_at >= ${start.toISOString()}::timestamptz
           AND u.occurred_at < ${end.toISOString()}::timestamptz
         GROUP BY u.model
      `)) as unknown as { model: string; prompts: number }[];

      const usedBy: Record<string, number> = {};
      for (const r of used) usedBy[r.model] = Number(r.prompts ?? 0);

      // Allowed = entitled aliases whose usage is still below the limit.
      // An alias with no limit entry (or limit <= 0) is NOT granted.
      const allowed = (org.models ?? []).filter((alias) => {
        const limit = Number(limits[alias] ?? 0);
        if (!Number.isFinite(limit) || limit <= 0) return false;
        return (usedBy[alias] ?? 0) < limit;
      });

      const teamId = org.litellm_team_id!;
      await updateTeamModels(teamId, allowed);
      const keys = await listTeamKeys(teamId);
      for (const k of keys) {
        // Models-only push: omit budget fields entirely (undefined keys
        // are dropped by JSON.stringify) so this job never touches the
        // budget sync.ts owns — it only narrows/restores the allowlist.
        await updateKeyLimits(k.token, {
          models: allowed,
          rpmLimit: null,
          tpmLimit: null,
          maxParallelRequests: null,
        });
      }

      // Narrowed = at least one entitled alias withheld.
      const entitled = (org.models ?? []).filter(
        (a) => Number(limits[a] ?? 0) > 0,
      );
      if (allowed.length < entitled.length) result.narrowed++;
      else result.restored++;
    } catch (e) {
      result.failed++;
      log.error('enforce_prompt_limits: org failed', {
        organizationId: org.organization_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
