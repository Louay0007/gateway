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

  const indicatorClass =
    percent >= 95
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : percent >= 80
        ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
        : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {alias === 'fast' ? 'Fast (Haiku 5.5)' : alias === 'smart' ? 'Smart (Sonnet 5.5)' : alias === 'frontier' ? 'Frontier (Opus 5.5)' : alias}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {(limit - used).toLocaleString()} / {limit.toLocaleString()} prompts remaining
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={`${alias} prompts: ${percent}% of ${limit}`}
        className={cn(
          "[&_[data-slot=progress-track]]:h-1.5",
          indicatorClass,
        )}
      />
    </div>
  );
}

/**
 * PromptMeters — renders one PromptMeter per model alias in the plan.
 *
 * Filters out aliases with a limit of 0 (not included in the plan) and
 * sorts by the plan's declared order (fast → smart → frontier).
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