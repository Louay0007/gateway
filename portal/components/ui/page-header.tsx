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
  size = "display",
}: {
  /** Small label above the title: "Pricing", "Connect", "Models". */
  eyebrow?: string;
  /**
   * Omit inside the signed-in shell. The sticky header already renders the
   * page's `h1` from `titleForPath`, so a title here is the same word twice
   * on one screen, 64px apart. Console pages pass `lede` + `actions` only.
   */
  title?: ReactNode;
  /** One or two sentences. Kept to a readable measure. */
  lede?: ReactNode;
  /** Buttons on the right at ≥sm, below the title on mobile. */
  actions?: ReactNode;
  /** Facts row under the lede (base URL, auth, plans…). */
  meta?: ReactNode;
  className?: string;
  /** `h2` inside an already-titled shell. */
  as?: "h1" | "h2";
  /**
   * `display` is the marketing scale (3xl/4xl). `console` is the signed-in
   * scale (xl) — a product page sits under a sticky header that already
   * carries the page title, so a 4xl heading there is a second masthead on
   * the same screen. Same component, same spacing logic, two sizes.
   */
  size?: "display" | "console";
}) {
  const console = size === "console";

  return (
    <header
      className={cn(
        "flex flex-col sm:flex-row sm:justify-between",
        console ? "gap-3 sm:items-end" : "gap-4 sm:items-start",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        {title ? (
          <Heading
            className={cn(
              "text-balance font-semibold tracking-tight text-foreground",
              eyeBrowSpacing(eyebrow),
              console ? "text-xl" : "text-3xl sm:text-4xl",
            )}
          >
            {title}
          </Heading>
        ) : null}
        {lede ? (
          <p
            className={cn(
              "max-w-2xl text-muted-foreground",
              console ? "text-sm leading-normal" : "mt-3 text-base leading-relaxed",
              // Without a title above it, the lede is the first line and
              // needs no top margin; with one, it needs the gap.
              console && !title ? "" : console ? "mt-1" : "",
            )}
          >
            {lede}
          </p>
        ) : null}
        {meta ? <div className={console ? "mt-3" : "mt-5"}>{meta}</div> : null}
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
