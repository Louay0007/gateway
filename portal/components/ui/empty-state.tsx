import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * EmptyState — the one empty-state in the product.
 *
 * WHY THIS EXISTS. The repo had FOUR ways to say "there is nothing here":
 * `FirstUseState` and `NoResultsState` in components/dashboard/states.tsx,
 * `AdminEmptyState` in components/admin/stat-card.tsx, and `ui/empty.tsx`
 * which was never imported by anything. Four vocabularies for one idea means
 * a customer sees a different empty screen on every tab, and a designer
 * fixes the same spacing three times.
 *
 * The four cases are genuinely different and are NOT collapsed into one
 * message — copy that treats them as one is the most common shortcut in
 * generated UI:
 *
 *   first-use   "you have none yet — do this"        (action: create)
 *   no-results  "nothing matched — clear the filter"  (action: clear)
 *   cleared     "nothing needs you"                   (no action; success)
 *   error       "it failed — try again"               (action: retry)
 *
 * This component renders the three that are not errors. Errors keep their
 * own destructive tone in `ErrorState`, because a red box is doing real work
 * there and must not look like an empty list.
 */
export function EmptyState({
  variant = "first-use",
  title,
  body,
  action,
  icon,
  className,
}: {
  variant?: "first-use" | "no-results" | "cleared";
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-3 px-6 text-center",
        variant === "first-use" ? "rounded-xl border border-dashed border-border bg-card py-14" : "py-16",
        className,
      )}
    >
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? (
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
