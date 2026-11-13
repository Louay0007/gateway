/**
 * /models — the public catalog, built from the same sources the product uses.
 *
 * TWO FACTS, ONE CARD.
 *
 *   1. What the alias COSTS — mirrored from `prices/models.yaml` via
 *      `TIERS` in components/docs/docs-data.ts, which the pricing
 *      consistency test already pins to the gateway config.
 *   2. What it HAS SERVED — a 7-day sum over `usage_records`, the same
 *      ledger the meter reads.
 *
 * The second is the part competitors publish and we did not. It is also the
 * only claim on the page that is not a promise: it is a measurement.
 *
 * ALIAS-ONLY. This module never returns an upstream model name, because the
 * page is public and the invariant that keeps an engine swap a config
 * change is that no customer anywhere sees the vendor.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { BILLABLE_TOKEN_COLUMNS } from '@/lib/entitlements/quota';
import {
  TIERS,
  POOL_PLANS,
  CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
} from '@/components/docs/docs-data';

export interface CatalogModel {
  alias: string;
  tagline: string;
  bestFor: string[];
  /** Dollars per million blended tokens, as published strings. */
  inputPerMtok: string;
  outputPerMtok: string;
  cacheReadPerMtok: string;
  /** Plans whose allowlist includes this alias. */
  plans: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** Blended tokens served in the last 7 days, or null when unreadable. */
  servedLast7d: number | null;
}

/**
 * Volume for every alias in one grouped scan.
 *
 * A failure here must not take the page down: the catalog is still true
 * without the volume line, and a public marketing page is the worst place
 * to render a database error. The caller renders "—" instead.
 */
export async function volumeLast7d(): Promise<Record<string, number>> {
  try {
    const rows = (await db.execute(sql`
      SELECT u.model,
             COALESCE(SUM(${sql.raw(BILLABLE_TOKEN_COLUMNS)}), 0)::bigint AS tokens
        FROM usage_records u
       WHERE u.occurred_at >= now() - INTERVAL '7 days'
       GROUP BY u.model
    `)) as unknown as { model: string; tokens: string | number }[];

    const out: Record<string, number> = {};
    for (const r of rows) out[r.model] = Number(r.tokens ?? 0);
    return out;
  } catch {
    return {};
  }
}

/** The catalog, alias-only, with live volume attached. */
export async function buildCatalog(): Promise<CatalogModel[]> {
  const volume = await volumeLast7d();

  return TIERS.map((t) => ({
    alias: t.alias,
    tagline: t.tagline,
    bestFor: t.bestFor,
    inputPerMtok: t.inputPerMtok,
    outputPerMtok: t.outputPerMtok,
    cacheReadPerMtok: t.cacheReadPerMtok,
    plans: t.plans,
    contextWindow: CONTEXT_WINDOW,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    servedLast7d: Object.prototype.hasOwnProperty.call(volume, t.alias)
      ? volume[t.alias]!
      : 0,
  }));
}

/** Which plan includes an alias, derived rather than hand-written twice. */
export function plansForAlias(alias: string): string[] {
  return POOL_PLANS.filter((p) => p.models.includes(alias)).map((p) => p.label);
}
