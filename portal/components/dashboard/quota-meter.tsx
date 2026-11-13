import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { compact } from "@/lib/dashboard/format";

/**
 * QuotaMeter — one alias and its blended-token budget.
 *
 * Tokens are the only quota (migration 0023). The bar fills with
 * used / limit; an exhausted alias renders red with an explicit badge so
 * it reads as "blocked" rather than merely "almost done".
 */

/** Raw-token formatter: 50000000 → "50M", 1500 → "1.5k". */
export function tokensCompact(value: number): string {
  return compact(value);
}

/**
 * QuotaPoolMeter — ONE bar for the plan's shared allowance (0039).
 *
 * Replaces the per-alias meters. Under a shared pool the per-alias figures
 * described a split that no longer binds: a customer with 3M "left on
 * smart" and 0 "left on fast" was being told the product was broken, when
 * in truth the pool simply had 3M in it. `poolTokens === null` means the
 * plan has no budget and the bar is not drawn.
 */
export function QuotaPoolMeter({
  poolTokens,
  poolUsedTokens,
  entitled,
  className,
}: {
  /** Total shared allowance, raw tokens. Null = unlimited. */
  poolTokens: number | null | undefined;
  poolUsedTokens: number;
  /** Shown as text so the customer knows what the pool may be spent on. */
  entitled?: string[];
  className?: string;
}) {
  const unlimited = typeof poolTokens !== 'number' || !Number.isFinite(poolTokens) || poolTokens <= 0;
  const used = Math.max(0, poolUsedTokens ?? 0);
  const limit = unlimited ? 0 : poolTokens;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const exhausted = !unlimited && used >= limit;
  const remaining = unlimited ? 0 : Math.max(0, limit - used);

  const tone =
    exhausted || percent >= 95
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : percent >= 80
        ? "[&_[data-slot=progress-indicator]]:bg-warning"
        : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          Tokens
          {exhausted ? (
            <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Out of tokens
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {unlimited ? (
            <>Unlimited</>
          ) : (
            <>{tokensCompact(remaining)} / {tokensCompact(limit)} tokens left</>
          )}
        </span>
      </div>
      {unlimited ? null : (
        <Progress
          value={exhausted ? 100 : percent}
          aria-label={`Shared token pool: ${exhausted ? 100 : percent}% of ${limit} used${exhausted ? ' (exhausted)' : ''}`}
          className={cn("[&_[data-slot=progress-track]]:h-1.5", tone)}
        />
      )}
      {entitled && entitled.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Shared across {entitled.join(", ")} — spend it on whichever you like.
        </p>
      ) : null}
    </div>
  );
}

export function QuotaMeter({
  usedTokens,
  tokenLimit,
  alias,
  className,
}: {
  usedTokens: number;
  /** Blended-token budget (raw). Undefined/0 = unlimited. */
  tokenLimit?: number;
  alias: string;
  className?: string;
}) {
  const hasTokenBudget =
    typeof tokenLimit === 'number' && Number.isFinite(tokenLimit) && tokenLimit > 0;
  const tokens = hasTokenBudget ? usedTokens : 0;
  const tokenLimitNum = (tokenLimit ?? 0) as number;
  const tokenRatio = hasTokenBudget ? tokens / tokenLimitNum : 0;
  const tokenPercent = hasTokenBudget ? Math.min(100, Math.round(tokenRatio * 100)) : 0;
  const exhausted = hasTokenBudget && tokens >= tokenLimitNum;

  const tokenClass =
    exhausted || tokenPercent >= 95
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : tokenPercent >= 80
        ? "[&_[data-slot=progress-indicator]]:bg-warning"
        : undefined;

  const label =
    alias === 'fast'
      ? 'Fast (Haiku 5.5)'
      : alias === 'smart'
        ? 'Smart (Sonnet 5.5)'
        : alias === 'frontier'
          ? 'Frontier (Opus 5.5)'
          : alias;

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {label}
          {exhausted ? (
            <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Out of tokens
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {exhausted ? (
            <>0 / {tokensCompact(tokenLimitNum)} tokens left</>
          ) : hasTokenBudget ? (
            <>{tokensCompact(Math.max(0, tokenLimitNum - tokens))} / {tokensCompact(tokenLimitNum)} tokens left</>
          ) : (
            <>Unlimited</>
          )}
        </span>
      </div>
      {hasTokenBudget ? (
        <Progress
          value={exhausted ? 100 : tokenPercent}
          aria-label={`${alias} tokens: ${exhausted ? 100 : tokenPercent}% of ${tokenLimitNum}${exhausted ? ' (exhausted)' : ''}`}
          className={cn("[&_[data-slot=progress-track]]:h-1.5", tokenClass)}
        />
      ) : null}
    </div>
  );
}

/**
 * Exhausted-quota banner — `Out of tokens for this period — resets <end>`.
 *
 * 0039: ONE POOL, so this is a plan-level banner. It used to name each
 * exhausted alias, which was honest under per-alias caps and became wrong
 * the moment the allowance was shared: there is no "fast pool" to be out
 * of. Driven by the resolved pool numbers so it cannot disagree with the
 * gateway wall.
 */
export function QuotaExhaustedBanner({
  poolTokens,
  poolUsedTokens,
  resetDate,
  className,
}: {
  poolTokens?: number | null;
  poolUsedTokens?: number;
  resetDate?: string | null;
  className?: string;
}) {
  if (typeof poolTokens !== 'number' || !Number.isFinite(poolTokens) || poolTokens <= 0) {
    return null;
  }
  if ((poolUsedTokens ?? 0) < poolTokens) return null;
  // Budgets are monthly, so the reset is the period end — never a midnight.
  // Saying "tomorrow" sends the customer to bed for nothing.
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm',
        className,
      )}
    >
      <span className="font-medium">Out of tokens for this period</span>
      <span className="text-muted-foreground">
        {resetDate
          ? `— resets ${new Date(resetDate).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            })}. Upgrade for more or wait for renewal.`
          : '— upgrade for more or wait for renewal.'}
      </span>
      <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        {tokensCompact(poolTokens)} used
      </span>
    </div>
  );
}

/**
 * QuotaMeters — one QuotaMeter per alias with a token budget.
 *
 * Order follows the plan's declared fast → smart → frontier. Aliases with
 * no budget are unlimited and get no bar.
 */
export function QuotaMeters({
  tokensByModel,
  tokenLimits,
  entitled,
  className,
}: {
  tokensByModel?: Record<string, number>;
  tokenLimits?: Record<string, number>;
  /** Only meters for entitled aliases are shown. */
  entitled?: string[];
  className?: string;
}) {
  const ALIAS_ORDER = ["fast", "smart", "frontier", "fable"];
  const allowed = entitled ? new Set(entitled) : null;
  const entries = ALIAS_ORDER.filter(
    (alias) =>
      (tokenLimits ?? {})[alias] != null && (allowed == null || allowed.has(alias)),
  ).map((alias) => ({
    alias,
    usedTokens: (tokensByModel ?? {})[alias] ?? 0,
    tokenLimit: (tokenLimits ?? {})[alias],
  }));

  if (entries.length === 0) return null;

  return (
    <div className={cn("grid gap-4", className)}>
      {entries.map((e) => (
        <QuotaMeter
          key={e.alias}
          usedTokens={e.usedTokens}
          tokenLimit={e.tokenLimit}
          alias={e.alias}
        />
      ))}
    </div>
  );
}
