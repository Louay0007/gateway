/**
 * Token quota — the ONLY wall rule, shared by every enforcement point.
 *
 * WHY ONE MODULE: enforce (quota-aware) and sync (quota-blind) used to push
 * different allowlists; sync resurrected what enforce narrowed. Both now
 * compute through computeTokenAllowedModels so they cannot disagree.
 *
 * RULE (0039): ONE SHARED POOL per plan. The plan's allowance is the SUM of
 * its `token_limits`, and that pool is spendable on ANY alias the plan
 * unlocks — 50M means 50M, whether it goes to fast, to smart, or split. An
 * alias is never cut while the pool has tokens left; when the pool is gone,
 * every alias is cut at once.
 *
 * WHY POOLED, NOT PER-ALIAS (0038 → 0039). 0038 split 50M into fifteens of
 * millions per alias, which quietly reintroduced the problem it was written
 * to fix: Pro's 50M across three aliases gave 16.7M per model, LESS per
 * model than Starter's 25M on a plan costing 1.8x more. A customer who
 * wanted to spend their whole allowance on one strong model could not. The
 * pool has no such inversion and needs no product decision about how to
 * split — the customer decides, by spending.
 *
 * `token_limits` therefore now means **allocations that sum to the pool**,
 * not independent caps. The per-alias values stay in the column (and in the
 * admin editor) so a plan can still describe its shape, but enforcement
 * reads only their sum. Migration 0038's numbers already sum to exactly
 * 50M per plan, so this needed no schema change; a future plan can publish
 * `{fast: 50000000}` or `{fast: 25000000, smart: 25000000}` and both mean
 * 50M shared.
 *
 * WINDOW: the subscription period (or the calendar month when none is
 * known). 0025's daily window was a 30x giveaway on a monthly-priced
 * product — a per-alias daily budget summed over a month. 0038 fixed the
 * unit; this module fixes the shape.
 *
 * Units: RAW TOKENS as the ledger stores them (integers, NOT millions, NOT
 * cents). 50000000 = 50M blended tokens per period.
 *
 * MISSING / ZERO = UNLIMITED. Token budgets postdate plans, so a plan an
 * operator created before 0023 may have no entry — failing closed would cut
 * every such plan on the first pass after deploy. An alias with no entry is
 * NOT part of the pool and is never cut by it; the 0038 guard forces
 * budgets onto starter/pro/trial, so the fail-open only covers plans nobody
 * configured.
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

/**
 * The plan's shared token pool: the SUM of its per-alias allocations.
 *
 * `null` means the plan has no token budget at all (every entry missing or
 * non-positive) and is therefore UNLIMITED. A partially-filled plan still
 * pools — `{fast: 50000000}` and `{fast: 25000000, smart: 25000000}` both
 * yield 50,000,000, because the column describes the shape of one
 * allowance, not a cap per model.
 */
export function tokenPoolFromLimits(tokenLimits: TokenLimits): number | null {
  let sum = 0;
  let sawPositive = false;
  for (const value of Object.values(tokenLimits ?? {})) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue; // 0 / missing = not part of the pool
    sawPositive = true;
    sum += n;
  }
  return sawPositive ? sum : null;
}

/**
 * Blended tokens spent in the window — the number compared to the pool.
 *
 * Counts every alias the org used plus the `unknown` bucket. Unmapped spend
 * must land somewhere or it is free inference, and with one pool there is no
 * over-charging question left to answer: the stray tokens are simply part of
 * what the org consumed. The collector still reports unmapped models
 * loudly, so an operator sees the cause rather than a customer seeing a
 * free tier.
 */
export function tokensUsedInWindow(usedTokensBy: UsageTokensByModel): number {
  const u = usedTokensBy ?? {};
  let total = 0;
  for (const value of Object.values(u)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * The wall: which entitled aliases may serve right now.
 *
 * ONE POOL, so this is all-or-nothing per plan — either the allowance has
 * tokens left and every entitled alias serves, or it is spent and none do.
 * There is no per-alias narrowing any more, which is the whole point: a
 * customer who spent 45M on fast still has 5M to spend on smart.
 */
export function computeTokenAllowedModels(
  entitled: string[],
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): string[] {
  const e = Array.isArray(entitled) ? entitled : [];
  const pool = tokenPoolFromLimits(tokenLimits);
  if (pool === null) return e; // no budget = unlimited
  return tokensUsedInWindow(usedTokensBy) < pool ? e : [];
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
 * Tokens this alias has spent, plus every unmapped token.
 *
 * Kept for the surfaces that report a per-alias figure (the dashboard
 * breakdown). It is NOT compared to a limit any more — under one pool an
 * alias is never independently cut. See `remainingTokensByModel`.
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

/**
 * Tokens left in the plan's SHARED pool, or `null` when unlimited.
 *
 * Deliberately not per alias. The old shape returned `{fast: N, smart: M}`
 * with each figure measured against its own cap, which is exactly the
 * contract this change removes: it let a customer sit on 3M of unused
 * "smart" while being told they were out of "fast".
 */
export function remainingTokensByModel(
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): { pool: number } | Record<string, never> {
  const pool = tokenPoolFromLimits(tokenLimits);
  if (pool === null) return {};
  return { pool: Math.max(0, pool - tokensUsedInWindow(usedTokensBy)) };
}

/**
 * Is the plan out of tokens — the SAME answer for every alias.
 *
 * A signature that took an alias was the old per-alias contract. It stays
 * for callers that loop over aliases, but the alias no longer changes the
 * result: the pool is either spent or it is not.
 */
export function isTokenExhausted(
  _alias: string,
  tokenLimits: TokenLimits,
  usedTokensBy: UsageTokensByModel,
): boolean {
  const pool = tokenPoolFromLimits(tokenLimits);
  if (pool === null) return false; // unlimited
  return tokensUsedInWindow(usedTokensBy) >= pool;
}

/**
 * Customer-facing exhaustion copy.
 *
 * ONE POOL, so the message names no model: "out of fast tokens" was wrong
 * the moment the allowance became shared — a customer reading it would try
 * smart, find it also refused, and conclude the product was broken. The
 * alias argument is kept so callers that pass the requested model keep
 * type-checking, but the copy is plan-wide.
 *
 * Defaults to `period` because every budget is monthly since 0038. `daily`
 * remains for the one case a row is deliberately put on a Tunis day.
 * Getting this backwards is not cosmetic: telling a customer with a monthly
 * allowance that it "resets at midnight" makes them wait up for a reset that
 * never comes, and then churn.
 */
export function outOfTokensMessage(
  _alias: string,
  resetDate?: Date | string | null,
  cadence: 'daily' | 'period' = 'period',
): string {
  const base =
    cadence === 'daily'
      ? 'Out of tokens for today'
      : 'Out of tokens for this period';
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
