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

/** Raw-token formatter: 80000000 → "80M", 1500 → "1.5k". */
export function tokensCompact(value: number): string {
  return compact(value);
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
        ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
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
 * Exhausted-quota banner — `Out of <alias> tokens — resets <date>`.
 *
 * Same source as the gateway wall (token limits vs period usage): when an
 * entitled alias has 0 tokens remaining, the wall is already 403ing it.
 * Null when nothing is exhausted.
 */
export function QuotaExhaustedBanner({
  tokensByModel,
  tokenLimits,
  entitled,
  resetDate,
  className,
}: {
  tokensByModel?: Record<string, number>;
  tokenLimits?: Record<string, number>;
  entitled?: string[];
  resetDate?: string | null;
  className?: string;
}) {
  const planAliases =
    Array.isArray(entitled) && entitled.length > 0
      ? entitled
      : Object.keys(tokenLimits ?? {});
  const out: { alias: string }[] = [];
  for (const alias of planAliases) {
    const tLimit = Number((tokenLimits ?? {})[alias] ?? Infinity);
    const tUsed = Number((tokensByModel ?? {})[alias] ?? 0);
    if (Number.isFinite(tLimit) && tLimit > 0 && tUsed >= tLimit) {
      out.push({ alias });
    }
  }
  if (out.length === 0) return null;
  const label = resetDate ? new Date(resetDate) : null;
  const reset =
    label && !Number.isNaN(label.getTime())
      ? label.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
      : null;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm',
        className,
      )}
    >
      <span className="font-medium">
        {out.map((o) => `Out of ${o.alias} tokens`).join(' · ')}
      </span>
      <span className="text-muted-foreground">
        {reset ? `— resets ${reset}.` : '— renews next period.'} Upgrade for more or wait for renewal.
      </span>
      {out.map((o) => (
        <span
          key={o.alias}
          className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
        >
          {o.alias}: 0 tokens left
        </span>
      ))}
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
  className,
}: {
  tokensByModel?: Record<string, number>;
  tokenLimits?: Record<string, number>;
  className?: string;
}) {
  const ALIAS_ORDER = ["fast", "smart", "frontier"];
  const entries = ALIAS_ORDER.filter(
    (alias) => (tokenLimits ?? {})[alias] != null,
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
