/**
 * DB-backed quota wall — the single source of allowed models.
 *
 * Used by BOTH enforce_prompt_limits (5m) and sync (plan change +
 * hourly backstop) so they cannot disagree. Rule: allowed = entitled
 * WHERE tokens_used < token_limit, windowed on subscription period else
 * calendar month (same as dashboard bundle). Renewal restores: a new
 * window has zero usage so everything re-allows.
 *
 * Token-only since 0023. `prompt_count` stays in the ledger for analytics
 * but is never read here.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  computeTokenAllowedModels,
  usageWindowFor,
  BILLABLE_TOKEN_COLUMNS,
} from '@/lib/entitlements/quota';
import { effectForStatus, type Effect } from '@/lib/entitlements/policy';

export interface AllowedModelsResult {
  effect: Effect;
  entitled: string[];
  allowed: string[];
  /** Per-alias token budgets (raw blended tokens). 0023. */
  tokenLimits: Record<string, number>;
  /** Blended tokens used per alias in the window. 0023. */
  usedTokensBy: Record<string, number>;
  period: { start: Date; end: Date } | null;
  planCode: string | null;
}

export async function getAllowedModels(
  organizationId: string,
): Promise<AllowedModelsResult> {
  const rows = (await db.execute(sql`
    SELECT s.status, s.current_period_start, s.current_period_end,
           p.code AS plan_code, p.models,
           COALESCE(p.token_limits, '{}'::jsonb) AS token_limits
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
    token_limits: Record<string, number>;
  }[];

  const row = rows[0];
  if (!row) {
    return {
      effect: 'cut',
      entitled: [],
      allowed: [],
      tokenLimits: {},
      usedTokensBy: {},
      period: null,
      planCode: null,
    };
  }

  const effect = effectForStatus(row.status);
  const entitled: string[] = Array.isArray(row.models) ? row.models : [];
  // Token budgets. Missing = unlimited, enforced inside
  // computeTokenAllowedModels — NOT normalized to deny.
  const rawTokenLimits = (row as { token_limits?: unknown }).token_limits as Record<string, number> | undefined;
  const tokenLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawTokenLimits ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) tokenLimits[k] = v;
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
      tokenLimits: {},
      usedTokensBy: {},
      period: window,
      planCode: row.plan_code,
    };
  }

  const window = usageWindowFor({
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
  });

  const usedRows = (await db.execute(sql`
    SELECT u.model,
           COALESCE(SUM(${sql.raw(BILLABLE_TOKEN_COLUMNS)}), 0)::bigint AS tokens
      FROM usage_records u
     WHERE u.organization_id = ${organizationId}::uuid
       AND u.occurred_at >= ${window.start.toISOString()}::timestamptz
       AND u.occurred_at < ${window.end.toISOString()}::timestamptz
     GROUP BY u.model
  `)) as unknown as { model: string; tokens: string | number }[];

  const usedTokensBy: Record<string, number> = {};
  for (const r of usedRows) {
    usedTokensBy[r.model] = Number(r.tokens ?? 0);
  }

  // Token-only wall (0023): the only usage signal is blended tokens.
  const allowed = computeTokenAllowedModels(entitled, tokenLimits, usedTokensBy);
  return { effect, entitled, allowed, tokenLimits, usedTokensBy, period: window, planCode: row.plan_code };
}
