import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * PromptMeter — per-model prompt usage against the plan's limit.
 *
 * Migration 0013 replaced token-budget enforcement with prompt-count limits.
 * Each inference request = 1 prompt. Token stats remain visible as secondary
 * info but are no longer the hard limit.
 *
 * Shows one bar per model alias the plan includes. Amber at 80%, red at 95%
 * — same thresholds as the old SpendMeter, so the color change is a warning
 * the gateway also enforces.
 */
export function PromptMeter({
  used,
  limit,
  alias,
  className,
}: {
  used: number;
  limit: number;
  alias: string;
  className?: string;
}) {
  const ratio = limit > 0 ? used / limit : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const exhausted = limit > 0 && used >= limit;
  const remaining = Math.max(0, limit - used);

  const indicatorClass =
    exhausted || percent >= 95
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : percent >= 80
        ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
        : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {alias === 'fast' ? 'Fast (Haiku 5.5)' : alias === 'smart' ? 'Smart (Sonnet 5.5)' : alias === 'frontier' ? 'Frontier (Opus 5.5)' : alias}
          {exhausted ? (
            <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Out of prompts
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {exhausted ? (
            <>0 / {limit.toLocaleString()} prompts remaining</>
          ) : (
            <>{remaining.toLocaleString()} / {limit.toLocaleString()} prompts remaining</>
          )}
        </span>
      </div>
      <Progress
        value={exhausted ? 100 : percent}
        aria-label={`${alias} prompts: ${exhausted ? 100 : percent}% of ${limit}${exhausted ? ' (exhausted)' : ''}`}
        className={cn(
          "[&_[data-slot=progress-track]]:h-1.5",
          indicatorClass,
        )}
      />
    </div>
  );
}

/**
 * Exhausted-quota banner — `Out of <alias> prompts — resets <date>`.
 *
 * Rendered from the subscription bundle (limits vs period usage): when an
 * entitled alias has 0 remaining, the gateway wall is already 403ing it,
 * so the page must say so in plain language with the renewal date.
 * Null when nothing is exhausted (no banner, no noise).
 */
export function ExhaustedBanner({
  promptsByModel,
  promptLimits,
  entitled,
  resetDate,
  className,
}: {
  promptsByModel: Record<string, number>;
  promptLimits: Record<string, number>;
  entitled?: string[];
  resetDate?: string | null;
  className?: string;
}) {
  const planAliases = Array.isArray(entitled) && entitled.length > 0
    ? entitled
    : Object.keys(promptLimits ?? {});
  const out = planAliases.filter((alias) => {
    const limit = Number((promptLimits ?? {})[alias] ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return false;
    const used = Number((promptsByModel ?? {})[alias] ?? 0);
    return used >= limit;
  });
  if (out.length === 0) return null;
  const label = resetDate ? new Date(resetDate) : null;
  const reset = label && !Number.isNaN(label.getTime())
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
        {out.map((a) => `Out of ${a} prompts`).join(' · ')}
      </span>
      <span className="text-muted-foreground">
        {reset ? `— resets ${reset}.` : '— renews next period.'} Upgrade for more or wait for renewal.
      </span>
      {out.map((a) => (
        <span
          key={a}
          className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
        >
          {a}: 0 remaining
        </span>
      ))}
    </div>
  );
}

/**
 * PromptMeters — renders one PromptMeter per model alias in the plan.
 *
 * Filters out aliases with a limit of 0 (not included in the plan) and
 * sorts by the plan's declared order (fast → smart → frontier). Exhausted
 * aliases render at 100% red with an explicit `Out of prompts` badge —
 * the bar alone reads as "almost done", the badge as "blocked".
 */
export function PromptMeters({
  promptsByModel,
  promptLimits,
  className,
}: {
  promptsByModel: Record<string, number>;
  promptLimits: Record<string, number>;
  className?: string;
}) {
  const ALIAS_ORDER = ["fast", "smart", "frontier"];
  const entries = ALIAS_ORDER.filter(
    (alias) => (promptLimits[alias] ?? 0) > 0,
  ).map((alias) => ({
    alias,
    used: promptsByModel[alias] ?? 0,
    limit: promptLimits[alias]!,
  }));

  if (entries.length === 0) return null;

  return (
    <div className={cn("grid gap-4", className)}>
      {entries.map((e) => (
        <PromptMeter
          key={e.alias}
          used={e.used}
          limit={e.limit}
          alias={e.alias}
        />
      ))}
    </div>
  );
}