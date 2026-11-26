import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * MetricRail — the console's one way to show a row of figures.
 *
 * WHY THIS REPLACED THE STAT-CARD GRID. The overview led with five
 * `StatCard`s: five bordered boxes, each with an icon, a 24px number, a
 * label and a hint. That is the hero-metric template, and it cost the page
 * five card borders and ~120px of vertical space to say four numbers. It
 * also orphaned the fifth card on a second row at every desktop width.
 *
 * A rail is the honest shape for peer figures: ONE surface, hairline
 * dividers, no icons competing with the numbers, and a footer slot for the
 * one thing that belongs to all of them (the reset date, the budget bar).
 * The `gap-px` + `bg-border` trick draws the dividers, so they are correct
 * at every breakpoint without a single `nth-child` rule.
 *
 * `tone` is the only colour: a figure that has crossed a threshold says so
 * with the same `--warning` / `--destructive` tokens the status strip uses,
 * so the rail and the sentence above it cannot disagree.
 */
export interface MetricRailItem {
  label: string;
  value: string;
  /** One short qualifier under the value. Not a sentence. */
  hint?: ReactNode;
  /** A sparkline or meter that belongs to this figure. */
  visual?: ReactNode;
  tone?: "default" | "warning" | "destructive";
}

const TONE_VALUE: Record<NonNullable<MetricRailItem["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function MetricRail({
  items,
  footer,
  className,
}: {
  items: MetricRailItem[];
  /** Belongs to every figure: the reset date, the shared-pool bar. */
  footer?: ReactNode;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div
        className={cn(
          "grid gap-px bg-border",
          // Two up on tablet, four across on desktop. `gap-px` over a
          // `bg-border` parent is what draws the hairlines.
          items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="grid content-start gap-1 bg-card px-4 py-3.5">
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums tracking-tight",
                TONE_VALUE[item.tone ?? "default"],
              )}
            >
              {item.value}
            </p>
            {item.hint ? (
              <p className="text-xs leading-snug text-muted-foreground">{item.hint}</p>
            ) : null}
            {item.visual ? <div className="pt-1">{item.visual}</div> : null}
          </div>
        ))}
      </div>
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </Card>
  );
}
