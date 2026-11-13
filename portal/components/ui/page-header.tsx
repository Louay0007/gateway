import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * PageHeader — the one page-title block.
 *
 * WHY THIS EXISTS. Every page composed its own: /dashboard had a title
 * inside a Card, /pricing had an eyebrow + h1 + lede + badge stack,
 * /connect and /models repeated that inline, and admin pages use their own
 * `AdminHeader`. The result is that the gap between a title and its lede is
 * 12px on one page and 20px on the next, and a heading level is inconsistent
 * enough that the outline is wrong for assistive tech.
 *
 * Deliberately NOT a Card. A page title is page chrome, not content; giving
 * it a border makes every screen look like a widget on a dashboard.
 *
 * `AdminHeader` is left alone for now: the admin console has its own dense
 * vocabulary (stat rows, section dividers) and unifying it would be a
 * redesign, not a consolidation. Its props are compatible enough that it can
 * delegate to this later without touching call sites.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  meta,
  className,
  as: Heading = "h1",
}: {
  /** Small label above the title: "Pricing", "Connect", "Models". */
  eyebrow?: string;
  title: ReactNode;
  /** One or two sentences. Kept to a readable measure. */
  lede?: ReactNode;
  /** Buttons on the right at ≥sm, below the title on mobile. */
  actions?: ReactNode;
  /** Facts row under the lede (base URL, auth, plans…). */
  meta?: ReactNode;
  className?: string;
  /** `h2` inside an already-titled shell. */
  as?: "h1" | "h2";
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        <Heading
          className={cn(
            "text-balance font-semibold tracking-tight text-foreground",
            eyeBrowSpacing(eyebrow),
            "text-3xl sm:text-4xl",
          )}
        >
          {title}
        </Heading>
        {lede ? (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {lede}
          </p>
        ) : null}
        {meta ? <div className="mt-5">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** A title directly under an eyebrow needs less top margin than a bare one. */
function eyeBrowSpacing(eyebrow?: string): string {
  return eyebrow ? "mt-2" : "";
}
