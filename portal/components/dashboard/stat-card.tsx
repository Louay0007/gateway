import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * StatCard — the four-up metric tile the overview leads with.
 *
 * Deliberately simple: value is the loudest element (28px, tabular-nums so
 * changing numbers do not reflow the layout), label and hint are quiet.
 * `footer` is the escape hatch for tiles that carry a meter (spend) or a
 * tiny sparkline without special-casing the component.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  footer,
  className,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: LucideIcon;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Icon aria-hidden className="size-5 text-muted-foreground" />
        </div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      {footer ? <CardContent>{footer}</CardContent> : null}
    </Card>
  );
}
