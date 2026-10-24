/**
 * Prompt quota — pure wall rule shared by every enforcement point.
 *
 * WHY: enforce (quota-aware) and sync (quota-blind) pushed different
 * allowlists; sync resurrected what enforce narrowed. Both now compute
 * through computeAllowedModels so they cannot disagree.
 *
 * RULE (migration 0020, DO NOT CHANGE): prompt=1 IFF inference+200.
 * This file only compares counted usage vs entitled limits:
 * allowed = entitled WHERE used < limit. Missing alias = DENY.
 */
export type PromptLimits = Record<string, number>;
export type UsageByModel = Record<string, number>;

export function computeAllowedModels(
  entitled: string[],
  limits: Record<string, number>,
  usedBy: Record<string, number>,
): string[] {
  const e = Array.isArray(entitled) ? entitled : [];
  const l = limits ?? {};
  const u = usedBy ?? {};
  return e.filter((alias) => {
    const limit = Number((l as Record<string, unknown>)[alias] ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return false;
    const usedRaw = Number((u as Record<string, unknown>)[alias] ?? 0);
    if (!Number.isFinite(usedRaw) || usedRaw < 0) return false;
    return usedRaw < limit;
  });
}

export function remainingByModel(
  limits: Record<string, number>,
  usedBy: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [alias, limit] of Object.entries(limits ?? {})) {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) continue;
    const raw = Number((usedBy ?? {})[alias] ?? 0);
    const used = Number.isFinite(raw) && raw > 0 ? raw : 0;
    out[alias] = Math.max(0, limit - used);
  }
  return out;
}

export function exhaustedModels(
  entitled: string[],
  limits: Record<string, number>,
  usedBy: Record<string, number>,
): string[] {
  const allowed = new Set(computeAllowedModels(entitled, limits, usedBy));
  return (Array.isArray(entitled) ? entitled : []).filter((a) => !allowed.has(a));
}

export function isExhausted(
  alias: string,
  limits: Record<string, number>,
  usedBy: Record<string, number>,
): boolean {
  const limit = Number((limits ?? {})[alias] ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  const used = Number((usedBy ?? {})[alias] ?? 0);
  if (!Number.isFinite(used) || used < 0) return true;
  return used >= limit;
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

export function outOfPromptsMessage(
  alias: string,
  resetDate?: Date | string | null,
): string {
  const base = `Out of ${alias} prompts`;
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
  if (!/not\s+(available|allowed)|not\s+allowed\s+for|excluded|no\s+access|denied|out\s+of.*prompt/i.test(text)) {
    return null;
  }
  const aliasHit = text.match(/\b(fast|smart|frontier)\b/i);
  const quotedHit = text.match(/["']([A-Za-z0-9][A-Za-z0-9\-_]{1,64})["']/);
  const model = aliasHit ? aliasHit[1]!.toLowerCase() : quotedHit ? quotedHit[1]! : null;
  const friendly = model
    ? `${outOfPromptsMessage(model)} Check usage for remaining prompts.`
    : 'Model not available for this API key — you may be out of prompts or your plan does not include it. Check usage for remaining prompts.';
  return { model, friendly };
}

