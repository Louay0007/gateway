/**
 * Token quota — the ONLY wall rule, shared by every enforcement point.
 *
 * WHY ONE MODULE: enforce (quota-aware) and sync (quota-blind) used to push
 * different allowlists; sync resurrected what enforce narrowed. Both now
 * compute through computeTokenAllowedModels so they cannot disagree.
 *
 * RULE (migration 0023): allowed = entitled WHERE tokens_used < token_limit.
 * tokens_used = SUM(input + output + cache_write_5m + cache_write_1h +
 * cache_read) over the subscription window (period when known, calendar
 * month otherwise). Prompts are no longer a quota; `prompt_count` stays in
 * the ledger for historical analytics only.
 *
 * Units: RAW TOKENS as the ledger stores them (integers, NOT millions, NOT
 * cents): {fast: 80000000} = 80M tokens.
 *
 * MISSING / ZERO = UNLIMITED. Token budgets postdate plans, so a plan an
 * operator created before 0023 may have no entry — failing closed would cut
 * every such plan on the first pass after deploy. The 0023 guard forces
 * budgets onto starter/pro/trial and the admin editor writes them, so the
 * fail-open only covers plans nobody configured.
 */
export type TokenLimits = Record<string, number>;
export type UsageTokensByModel = Record<string, number>;

/** Blended tokens per alias: SUM(input+output+cache_writes+cache_read). */
export const BILLABLE_TOKEN_COLUMNS =
  'COALESCE(u.input_tokens,0) + COALESCE(u.output_tokens,0) ' +
  '+ COALESCE(u.cache_write_5m_tokens,0) + COALESCE(u.cache_write_1h_tokens,0) ' +
  '+ COALESCE(u.cache_read_tokens,0)';

export function computeTokenAllowedModels(
  entitled: string[],
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): string[] {
  const e = Array.isArray(entitled) ? entitled : [];
  const l = tokenLimits ?? {};
  const u = usedTokensBy ?? {};
  return e.filter((alias) => {
    const limit = Number((l as Record<string, unknown>)[alias] ?? Infinity);
    if (!Number.isFinite(limit)) return true; // missing = unlimited
    if (limit <= 0) return true; // 0 = unlimited, same rule
    const usedRaw = Number((u as Record<string, unknown>)[alias] ?? 0);
    if (!Number.isFinite(usedRaw) || usedRaw < 0) return false;
    return usedRaw < limit;
  });
}

export function usageWindowFor(
  subscription: {
    currentPeriodStart: Date | string | null;
    currentPeriodEnd: Date | string | null;
  } | null,
  now?: Date,
): { start: Date; end: Date } {
  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    return {
      start: new Date(subscription.currentPeriodStart),
      end: new Date(subscription.currentPeriodEnd),
    };
  }
  const ref = now ?? new Date();
  return {
    start: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)),
    end: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1)),
  };
}

export function remainingTokensByModel(
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [alias, limit] of Object.entries(tokenLimits ?? {})) {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) continue;
    const raw = Number((usedTokensBy ?? {})[alias] ?? 0);
    const used = Number.isFinite(raw) && raw > 0 ? raw : 0;
    out[alias] = Math.max(0, limit - used);
  }
  return out;
}

export function isTokenExhausted(
  alias: string,
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): boolean {
  const limit = Number((tokenLimits ?? {})[alias] ?? Infinity);
  if (!Number.isFinite(limit) || limit <= 0) return false; // unlimited
  const used = Number((usedTokensBy ?? {})[alias] ?? 0);
  if (!Number.isFinite(used) || used < 0) return true;
  return used >= limit;
}

export function outOfTokensMessage(
  alias: string,
  resetDate?: Date | string | null,
): string {
  const base = `Out of ${alias} tokens for this period`;
  if (!resetDate) return `${base}. Upgrade for more or wait for renewal.`;
  const d = new Date(resetDate);
  const label = Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return label ? `${base} — resets ${label}. Upgrade for more.` : `${base}. Upgrade for more.`;
}

export function mapGatewayModelError(
  upstreamStatus: number,
  bodyText: string,
): { model: string | null; friendly: string } | null {
  if (upstreamStatus !== 403 && upstreamStatus !== 429 && upstreamStatus !== 404) return null;
  const text = String(bodyText ?? '');
  if (!/not\s+(available|allowed)|not\s+allowed\s+for|excluded|no\s+access|denied|out\s+of.*token|quota/i.test(text)) {
    return null;
  }
  const aliasHit = text.match(/\b(fast|smart|frontier)\b/i);
  const quotedHit = text.match(/["']([A-Za-z0-9][A-Za-z0-9\-_]{1,64})["']/);
  const model = aliasHit ? aliasHit[1]!.toLowerCase() : quotedHit ? quotedHit[1]! : null;
  const friendly = model
    ? `${outOfTokensMessage(model)} Check usage for remaining tokens.`
    : 'Model not available for this API key — you may be out of tokens or your plan does not include it. Check usage for remaining tokens.';
  return { model, friendly };
}
