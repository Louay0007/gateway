import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * SpendMeter — the period's customer spend against the plan's included
 * amount, with the hard cap as the ceiling.
 *
 * Three numbers matter and the component shows all three: what you have
 * spent (`cost_customer_usd`), what the plan includes, and the cap that
 * stops traffic. The bar turns amber past 80% and destructive past 95% —
 * the same thresholds the gateway enforces, so the color change is a
 * warning, not decoration.
 *
 * The base-nova Progress renders its own track + indicator, so the sizing
 * and the threshold color are applied through root selectors rather than
 * child components — passing a second Track would render two bars.
 */
export function SpendMeter({
  spentUsd,
  includedCents,
  hardCapCents,
  className,
}: {
  spentUsd: number;
  includedCents: number;
  hardCapCents: number | null;
  className?: string;
}) {
  const included = includedCents / 100;
  const ratio = included > 0 ? spentUsd / included : 0;
  const percent = Math.min(100, Math.round(ratio * 100));

  // Threshold color, written as full literal utilities: Tailwind scans
  // source text, so a composed string never generates a rule. The
  // base-nova Progress owns the track/indicator, hence the root selector.
  const indicatorClass =
    percent >= 95
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : percent >= 80
        ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
        : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <Progress
        value={percent}
        aria-label={`Spend this period: ${percent}% of included`}
        className={cn(
          "[&_[data-slot=progress-track]]:h-1.5",
          indicatorClass,
        )}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>${spentUsd.toFixed(2)} of ${included.toFixed(2)} included</span>
        <span>
          {hardCapCents !== null
            ? `$${(hardCapCents / 100).toLocaleString()} cap`
            : "No cap"}
        </span>
      </div>
    </div>
  );
}
