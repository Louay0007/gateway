/**
 * enforce_prompt_limits — server-side TOKEN quota enforcement.
 *
 * The job name is historical (migrations 0007/0020); since 0023 it enforces
 * blended tokens only, and since 0025 the window is the TUNIS CALENDAR DAY
 * (100M per alias per day). Plans cap tokens per alias per day
 * (`plans.token_limits`). When an org has used >= its limit on an alias,
 * that alias is removed from the gateway allowlist (team models + every
 * key's models). When all entitled aliases are exhausted, the allowlist
 * becomes [] — every inference 403s with `Out of <alias> tokens for today`.
 *
 * Why narrow models instead of setting a tiny budget: LiteLLM reads a
 * budget of 0 as UNLIMITED, and budget math is customer-vs-upstream
 * denomination-sensitive. The model allowlist is exact: no alias listed
 * means no inference on that alias, with zero denomination risk.
 *
 * Idempotent: recomputes from the ledger every pass. An org under quota
 * is re-synced to its full plan allowlist (self-healing after drift), an
 * org over quota is narrowed. A new Tunis day restores automatically
 * because usage is windowed on the day.
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
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
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
}

export async function enforcePromptLimits(): Promise<EnforcePromptLimitsResult> {
  const result: EnforcePromptLimitsResult = {
    scanned: 0,
    narrowed: 0,
    restored: 0,
    failed: 0,
  };

  // Live orgs with a live subscription and a team to push to.
  // Plan/limits come from getAllowedModels per org (single wall with sync).
  // TOKEN WALL (0023): getAllowedModels withholds every alias whose blended
  // token budget is spent — one wall, one push.
  const orgs = (await db.execute(sql`
    SELECT o.id AS organization_id,
           o.litellm_team_id
      FROM organizations o
      JOIN subscriptions s ON s.organization_id = o.id
     WHERE o.status = 'active'
       AND s.status IN ('active', 'trialing', 'past_due', 'paused')
       AND o.litellm_team_id IS NOT NULL
  `)) as unknown as OrgPlan[];

  for (const org of orgs) {
    result.scanned++;
    try {
      // Single wall: same helper sync() uses, so the two cannot disagree.
      // Window + allowed computed identically; renewal restores because the
      // new window starts with zero usage in it.
      const wall = await getAllowedModels(org.organization_id);
      const allowed = wall.allowed;

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
      const entitled = wall.entitled;
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
