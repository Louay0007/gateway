import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { compact } from "@/lib/dashboard/format";
import { quotaPercent, quotaTone } from "@/lib/dashboard/quota-tone";

/**
 * The quota meter and the exhausted banner.
 *
 * Tokens are the only quota (migration 0023). Under one shared pool (0039)
 * there is exactly ONE bar — the per-alias `QuotaMeter`/`QuotaMeters` pair
 * was deleted here because nothing called it and it described a split that
 * no longer exists.
 *
 * Tones come from `lib/dashboard/quota-tone.ts`, the same module the status
 * strip reads, so the colour of this bar and the sentence at the top of the
 * page cannot drift apart.
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
  dailyCap,
  dailyUsed,
  className,
}: {
  /** Total shared allowance, raw tokens. Null = unlimited. */
  poolTokens: number | null | undefined;
  poolUsedTokens: number;
  /** Shown as text so the customer knows what the pool may be spent on. */
  entitled?: string[];
  /** Daily cap and today's spend (0043). Null cap = no daily limit. */
  dailyCap?: number | null;
  dailyUsed?: number;
  className?: string;
}) {
  const unlimited = typeof poolTokens !== 'number' || !Number.isFinite(poolTokens) || poolTokens <= 0;
  const used = Math.max(0, poolUsedTokens ?? 0);
  const limit = unlimited ? 0 : poolTokens;
  // Tone comes from the shared module, so this bar and the status strip at
  // the top of the page cannot disagree about what "almost out" means.
  const state = quotaTone(used, poolTokens);
  const percent = quotaPercent(used, poolTokens);
  const exhausted = state === 'blocked';
  const remaining = unlimited ? 0 : Math.max(0, limit - used);

  const tone =
    state === 'blocked' || state === 'warning'
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : state === 'watching'
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
          size="sm"
          className={cn("w-full", tone)}
        />
      )}
      {/* The daily cap is invisible until it stops you, which reads as a
          broken product. State the number up front, and how much of today
          is already gone. */}
      {dailyCap && dailyCap > 0 ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {tokensCompact(Math.max(0, dailyCap - (dailyUsed ?? 0)))} of{" "}
          {tokensCompact(dailyCap)} left today — the monthly pool refills this
          daily limit at midnight.
        </p>
      ) : null}
      {entitled && entitled.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Shared across {entitled.join(", ")} — spend it on whichever you like.
        </p>
      ) : null}
      {/* One ledger for every route. A chat turn, a raw /v1/messages call and
          a Claude Desktop request all write the same usage_records row and
          draw this same bar, so "27M used" is never chat-only or API-only.
          Saying so here is what stops the two from looking like separate
          meters that disagree. */}
      <p className="text-xs text-muted-foreground">
        Counts every request on your key — chat, API, and Claude Desktop alike.
      </p>
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
