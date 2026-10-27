/**
 * Token quota — the ONLY wall rule, shared by every enforcement point.
 *
 * WHY ONE MODULE: enforce (quota-aware) and sync (quota-blind) used to push
 * different allowlists; sync resurrected what enforce narrowed. Both now
 * compute through computeTokenAllowedModels so they cannot disagree.
 *
 * RULE (migration 0025): allowed = entitled WHERE tokens_used < token_limit.
 * tokens_used = SUM(input + output + cache_write_5m + cache_write_1h +
 * cache_read) over the TUNIS CALENDAR DAY (00:00–24:00 Africa/Tunis) when
 * the subscription is on daily quota, else the legacy monthly window
 * (subscription period when known, calendar month otherwise — grandfathered
 * rows until renewal). Prompts are no longer a quota; `prompt_count` stays
 * in the ledger for historical analytics only.
 *
 * Units: RAW TOKENS as the ledger stores them (integers, NOT millions, NOT
 * cents): {fast: 100000000} = 100M tokens per day.
 *
 * MISSING / ZERO = UNLIMITED. Token budgets postdate plans, so a plan an
 * operator created before 0023 may have no entry — failing closed would cut
 * every such plan on the first pass after deploy. The 0025 guard forces
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
  subscription: QuotaSubscriptionWindow | null,
  now?: Date,
): { start: Date; end: Date } {
  return usageWindowForSubscription(subscription, now);
}

/**
 * Africa/Tunis offset in minutes. Tunis is UTC+1 year-round — no DST —
 * so a fixed offset is exact, not an approximation (see also
 * lib/billing/promo.ts Halloween window + migration 0021 notes).
 */
export const TUNIS_OFFSET_MINUTES = 60;
export const TUNIS_OFFSET_MS = TUNIS_OFFSET_MINUTES * 60_000;
export const DAY_MS = 24 * 60 * 60_000;

/**
 * The Tunis calendar day containing `now`: [00:00 Tunis, 00:00 Tunis+1d).
 *
 * Pure arithmetic, no locale/date-string parsing: shift the UTC clock by
 * +60m, take the UTC calendar day of the shifted instant, shift back.
 * DST-safe precisely because Tunis has none.
 */
export function tunisDayWindow(now?: Date): { start: Date; end: Date } {
  const ref = now ?? new Date();
  const shifted = ref.getTime() + TUNIS_OFFSET_MS;
  const d = new Date(shifted);
  const dayStartUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = new Date(dayStartUtc - TUNIS_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** True while `t` falls inside the Tunis day starting at `dayStart`. */
export function isInTunisDay(t: Date | string | number, dayStart: Date): boolean {
  const ts = new Date(t).getTime();
  return (
    Number.isFinite(ts) &&
    ts >= dayStart.getTime() &&
    ts < dayStart.getTime() + DAY_MS
  );
}

export interface QuotaSubscriptionWindow {
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  /** 0025: TRUE = Tunis-day window; FALSE/absent = legacy monthly window. */
  dailyQuota?: boolean | null;
}

/**
 * The window the token wall sums over.
 *
 * - daily (dailyQuota TRUE, or no subscription row at all): the Tunis
 *   calendar day — generous budgets reset at midnight Tunis time.
 * - legacy (dailyQuota FALSE with a period): the subscription period.
 * - legacy fallback (dailyQuota FALSE without a period): UTC calendar month.
 */
export function usageWindowForSubscription(
  subscription: QuotaSubscriptionWindow | null,
  now?: Date,
): { start: Date; end: Date } {
  if (subscription?.dailyQuota === false) {
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
  return tunisDayWindow(now);
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
  cadence: 'daily' | 'period' = 'daily',
): string {
  const base =
    cadence === 'daily'
      ? `Out of ${alias} tokens for today`
      : `Out of ${alias} tokens for this period`;
  if (!resetDate) {
    return cadence === 'daily'
      ? `${base} — resets at midnight Tunis time. Upgrade for more.`
      : `${base}. Upgrade for more or wait for renewal.`;
  }
  const d = new Date(resetDate);
  if (Number.isNaN(d.getTime())) {
    return cadence === 'daily'
      ? `${base} — resets at midnight Tunis time. Upgrade for more.`
      : `${base}. Upgrade for more.`;
  }
  if (cadence === 'daily') {
    return `${base} — resets at midnight Tunis time. Upgrade for more.`;
  }
  const label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return label ? `${base} — resets ${label}. Upgrade for more.` : `${base}. Upgrade for more.`;
}

export function mapGatewayModelError(
  upstreamStatus: number,
  bodyText: string,
  requestedModel?: string | null,
  cadence: 'daily' | 'period' = 'daily',
): { model: string | null; friendly: string } | null {
  if (upstreamStatus !== 403 && upstreamStatus !== 429 && upstreamStatus !== 404) return null;
  const text = String(bodyText ?? '');
  if (!/not\s+(available|allowed)|not\s+allowed\s+for|excluded|no\s+access|denied|out\s+of.*token|quota/i.test(text)) {
    return null;
  }
  // Scan only inside the error MESSAGE for quoted candidates: the raw JSON's
  // first quoted token is the `"error"` key itself, and a message that once
  // claimed the model was 'error' came from exactly that mistake. An alias
  // the body names, or the model the customer actually requested, wins over
  // any guess extracted from wording.
  let messageText = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const err = (parsed as { error?: unknown }).error;
      if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        messageText = (err as { message: string }).message;
      } else if (typeof (parsed as { message?: unknown }).message === 'string') {
        messageText = (parsed as { message: string }).message;
      }
    }
  } catch {
    // Plaintext body — scan as-is.
  }
  const bodyAlias = text.match(/\b(fast|smart|frontier)\b/i)?.[1]?.toLowerCase() ?? null;
  const requested =
    requestedModel && ['fast', 'smart', 'frontier'].includes(requestedModel.toLowerCase())
      ? requestedModel.toLowerCase()
      : null;
  // Error-dialect words that carry no model identity, and the upstream model
  // names → alias, so a denial naming 'sonnet-5.5' still says 'smart'.
  const NON_MODEL_TOKENS = [
    'error', 'message', 'model', 'key', 'api_key', 'apikey', 'invalid',
    'invalid_request_error', 'request', 'access', 'denied', 'token', 'tokens',
    'plan', 'type', 'code', 'status', 'api', 'llm', 'provider',
  ];
  const UPSTREAM_TO_ALIAS: Record<string, string> = {
    'haiku-5.5': 'fast',
    'sonnet-5.5': 'smart',
    'opus-5.5': 'frontier',
  };
  const quoted = messageText.match(/["']([A-Za-z0-9][A-Za-z0-9_.\-]{1,64})["']/g) ?? [];
  const extracted =
    quoted
      .map((q) => q.slice(1, -1))
      .filter((token) => !NON_MODEL_TOKENS.includes(token.toLowerCase()))
      .map((token) => UPSTREAM_TO_ALIAS[token] ?? token)
      .find((token) => ['fast', 'smart', 'frontier'].includes(token.toLowerCase()))
      ?.toLowerCase() ?? null;
  const model = bodyAlias ?? requested ?? extracted;
  const friendly = model
    ? `${outOfTokensMessage(model, null, cadence)} Check usage for remaining tokens.`
    : 'Model not available for this API key — you may be out of tokens or your plan does not include it. Check usage for remaining tokens.';
  return { model, friendly };
}
