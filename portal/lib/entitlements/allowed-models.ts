/**
 * DB-backed quota wall — the single source of allowed models.
 *
 * Used by BOTH enforce_prompt_limits (5m) and sync (plan change +
 * hourly backstop) so they cannot disagree. Rule: allowed = entitled
 * WHERE used < limit, windowed on subscription period else calendar
 * month (same as dashboard bundle). Renewal restores: new window has
 * zero usage so everything re-allows.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  computeAllowedModels,
  usageWindowFor,
} from '@/lib/entitlements/quota';
import { effectForStatus, type Effect } from '@/lib/entitlements/policy';

export interface AllowedModelsResult {
  effect: Effect;
  entitled: string[];
  allowed: string[];
  limits: Record<string, number>;
  usedBy: Record<string, number>;
  period: { start: Date; end: Date } | null;
  planCode: string | null;
}

export async function getAllowedModels(
  organizationId: string,
): Promise<AllowedModelsResult> {
  const rows = (await db.execute(sql`
    SELECT s.status, s.current_period_start, s.current_period_end,
           p.code AS plan_code, p.models,
           COALESCE(p.prompt_limits, '{}'::jsonb) AS prompt_limits
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ${organizationId}::uuid
     ORDER BY (s.status IN ('active','past_due','paused','trialing')) DESC,
              s.updated_at DESC
     LIMIT 1
  `)) as unknown as {
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    plan_code: string;
    models: string[];
    prompt_limits: Record<string, number>;
  }[];

  const row = rows[0];
  if (!row) {
    return {
      effect: 'cut',
      entitled: [],
      allowed: [],
      limits: {},
      usedBy: {},
      period: null,
      planCode: null,
    };
  }

  const effect = effectForStatus(row.status);
  const entitled: string[] = Array.isArray(row.models) ? row.models : [];
  const rawLimits = (row.prompt_limits ?? {}) as Record<string, number>;
  const limits: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawLimits)) {
    if (typeof v === 'number' && Number.isFinite(v)) limits[k] = v;
  }

  if (effect === 'cut') {
    const window = usageWindowFor({
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
    });
    return {
      effect,
      entitled,
      allowed: [],
      limits: {},
      usedBy: {},
      period: window,
      planCode: row.plan_code,
    };
  }

  const window = usageWindowFor({
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
  });

  const usedRows = (await db.execute(sql`
    SELECT u.model, COALESCE(SUM(u.prompt_count), 0)::int AS prompts
      FROM usage_records u
     WHERE u.organization_id = ${organizationId}::uuid
       AND u.occurred_at >= ${window.start.toISOString()}::timestamptz
       AND u.occurred_at < ${window.end.toISOString()}::timestamptz
     GROUP BY u.model
  `)) as unknown as { model: string; prompts: number }[];

  const usedBy: Record<string, number> = {};
  for (const r of usedRows) usedBy[r.model] = Number(r.prompts ?? 0);

  const allowed = computeAllowedModels(entitled, limits, usedBy);
  return { effect, entitled, allowed, limits, usedBy, period: window, planCode: row.plan_code };
}
