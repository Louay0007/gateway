/**
 * Token quota — the ONLY wall rule, shared by every enforcement point.
 *
 * WHY ONE MODULE: enforce (quota-aware) and sync (quota-blind) used to push
 * different allowlists; sync resurrected what enforce narrowed. Both now
 * compute through computeTokenAllowedModels so they cannot disagree.
 *
 * RULE (migration 0038): allowed = entitled WHERE tokens_used < token_limit.
 * tokens_used = SUM(input + output + cache_write_5m + cache_write_1h +
 * cache_read) over the SUBSCRIPTION PERIOD (or the calendar month when no
 * period is known). Prompts are no longer a quota; `prompt_count` stays in
 * the ledger for historical analytics only.
 *
 * WHY MONTHLY, NOT DAILY. 0025 made the window the Tunis calendar day and
 * 0029 forced every row onto it, which turned a monthly token purchase into
 * a 30x giveaway: a per-alias 100M/day budget summed over a month is 3B per
 * alias, or 1,200 DT of tokens at 0.20 DT/M sold for 50 DT. A daily cap can
 * only be correct for a daily-priced product; this one bills monthly, so the
 * budget and the window must share that unit. 0038 rewrote both.
 *
 * `dailyQuota` is kept on the subscription row for the direction it now
 * documents: FALSE = monthly, the only shipping value since 0038. A TRUE row
 * still resolves to the Tunis day, so the helper below stays the single
 * definition and an operator can hand one row a daily window without a code
 * change — but no plan ships that way.
 *
 * Units: RAW TOKENS as the ledger stores them (integers, NOT millions, NOT
 * cents): {fast: 25000000} = 25M tokens over the billing period. Plans split
 * a monthly TOTAL across their aliases rather than repeating it per alias —
 * repeating is what multiplied the exposure in 0025.
 *
 * MISSING / ZERO = UNLIMITED. Token budgets postdate plans, so a plan an
 * operator created before 0023 may have no entry — failing closed would cut
 * every such plan on the first pass after deploy. The 0038 guard forces
 * budgets onto starter/pro/trial and the admin editor writes them, so the
 * fail-open only covers plans nobody configured.
 */
export type TokenLimits = Record<string, number>;
export type UsageTokensByModel = Record<string, number>;

/**
 * Blended tokens per alias.
 *
 * `fresh_input_tokens` (0028), NOT `input_tokens`. The raw column holds the
 * provider's `prompt_tokens`, which already includes the cached reads, so
 * adding `cache_read_tokens` to it counted the cached portion twice —
 * measured at 595,926 where the true figure was 298,637. Every alias was
 * therefore charged roughly double on cache-heavy workloads and customers
 * were cut early.
 *
 * The four buckets below are disjoint, and their sum equals the provider's
 * `prompt_tokens + completion_tokens` — the identity the tests assert.
 *
 * `COALESCE(fresh_input_tokens, ...)`: 0028 backfills every row and the
 * collector writes it on every insert, so NULL should be unreachable. The
 * fallback keeps a pre-0028 row (a restored older dump) from contributing
 * a phantom zero, and it degrades to the OLD behaviour rather than
 * silently under-counting.
 */
export const BILLABLE_TOKEN_COLUMNS =
  'COALESCE(u.fresh_input_tokens, u.input_tokens - LEAST(u.cache_read_tokens, u.input_tokens)) ' +
  '+ COALESCE(u.output_tokens,0) ' +
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
  // UNMAPPED SPEND IS STILL SPEND. A row whose `model` resolved to
  // `UNKNOWN_ALIAS` (a deployed model with no `aliases:` entry in
  // prices/models.yaml) belongs to no alias, so with a plain per-alias sum
  // it counts against nothing and the tokens are free. That is not a
  // theoretical hole: it opens the moment an upstream is added to LiteLLM
  // without a matching alias, and it opens silently.
  //
  // The unknown bucket is charged to EVERY entitled alias. Over-charging is
  // the correct direction — the alternative is unlimited free inference —
  // and the collector already reports unmapped models loudly, so an
  // operator sees the cause instead of a customer seeing a free tier.
  return e.filter((alias) => {
    const limit = Number((l as Record<string, unknown>)[alias] ?? Infinity);
    if (!Number.isFinite(limit)) return true; // missing = unlimited
    if (limit <= 0) return true; // 0 = unlimited, same rule
    const usedRaw = Number((u as Record<string, unknown>)[alias] ?? 0);
    if (!Number.isFinite(usedRaw) || usedRaw < 0) return false;
    return chargedTokensFor(alias, u) < limit;
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
  /** 0038: FALSE = monthly window (the only shipping value). TRUE = Tunis day. */
  dailyQuota?: boolean | null;
}

/**
 * The window the token wall sums over.
 *
 * - monthly (dailyQuota FALSE with a period): the subscription period. This
 *   is every row since 0038, and the only window a monthly token budget can
 *   be measured against.
 * - monthly fallback (dailyQuota FALSE without a period): UTC calendar month.
 * - daily (dailyQuota TRUE, or no subscription row at all): the Tunis
 *   calendar day. Kept so one row can be given a daily window without a code
 *   change; no plan ships this way since 0038.
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

/**
 * Tokens charged to an alias: its own spend PLUS every unmapped token.
 *
 * See `computeTokenAllowedModels` for why the `unknown` bucket is charged
 * to all aliases. Exported so the wall, the device pre-check and the
 * dashboard all read one number — three surfaces disagreeing about what a
 * customer used is the exact class of bug this module exists to prevent.
 */
export function chargedTokensFor(alias: string, usedTokensBy: UsageTokensByModel): number {
  const u = usedTokensBy ?? {};
  const own = Number((u as Record<string, unknown>)[alias] ?? 0);
  const stray = Number((u as Record<string, unknown>)[UNKNOWN_TOKENS_KEY] ?? 0);
  const ownTokens = Number.isFinite(own) && own > 0 ? own : 0;
  const strayTokens = Number.isFinite(stray) && stray > 0 ? stray : 0;
  return ownTokens + strayTokens;
}

/** The key `aliasForRow` writes when no `aliases:` entry matched. */
export const UNKNOWN_TOKENS_KEY = 'unknown';

export function remainingTokensByModel(
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [alias, limit] of Object.entries(tokenLimits ?? {})) {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) continue;
    out[alias] = Math.max(0, limit - chargedTokensFor(alias, usedTokensBy));
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
  const own = Number((usedTokensBy ?? {})[alias] ?? 0);
  if (!Number.isFinite(own) || own < 0) return true;
  return chargedTokensFor(alias, usedTokensBy) >= limit;
}

/**
 * Customer-facing exhaustion copy.
 *
 * Defaults to `period` because every budget shipping since 0038 is monthly.
 * `daily` remains for the one case a row is deliberately put on a Tunis day.
 * Getting this backwards is not cosmetic: telling a customer with a monthly
 * allowance that it "resets at midnight" makes them wait up for a reset that
 * never comes, and then churn.
 */
export function outOfTokensMessage(
  alias: string,
  resetDate?: Date | string | null,
  cadence: 'daily' | 'period' = 'period',
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
  cadence: 'daily' | 'period' = 'period',
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
  const bodyAlias = text.match(/\b(fast|smart|frontier|fable)\b/i)?.[1]?.toLowerCase() ?? null;
  const requested =
    requestedModel && ['fast', 'smart', 'frontier', 'fable'].includes(requestedModel.toLowerCase())
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
    'gpt-6-astra': 'fable',
  };
  const quoted = messageText.match(/["']([A-Za-z0-9][A-Za-z0-9_.\-]{1,64})["']/g) ?? [];
  const extracted =
    quoted
      .map((q) => q.slice(1, -1))
      .filter((token) => !NON_MODEL_TOKENS.includes(token.toLowerCase()))
      .map((token) => UPSTREAM_TO_ALIAS[token] ?? token)
      .find((token) => ['fast', 'smart', 'frontier', 'fable'].includes(token.toLowerCase()))
      ?.toLowerCase() ?? null;
  const model = bodyAlias ?? requested ?? extracted;
  const friendly = model
    ? `${outOfTokensMessage(model, null, cadence)} Check usage for remaining tokens.`
    : 'Model not available for this API key — you may be out of tokens or your plan does not include it. Check usage for remaining tokens.';
  return { model, friendly };
}
