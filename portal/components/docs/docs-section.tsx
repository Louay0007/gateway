import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Section — the docs page's repeating rhythm, now with a change of register.
 *
 * THE PROBLEM. Every section carried an identical kicker + `text-2xl` title +
 * lede + `mt-6` content grid, so a reader 4000px in had no signal about where
 * one topic ended and the next began beyond a lot of white space. Seven
 * identical blocks read as one long scroll.
 *
 * THE FIX, and it is deliberately small:
 *
 *   - The kicker stops being a sentence-case label and becomes a numbered
 *     index mark in the margin (`01`, `02`, …). The sequence is real here —
 *     quickstart before models before wire formats — so the number carries
 *     information rather than decorating.
 *   - The title drops to `text-xl` and the rule above it does the separating,
 *     which tightens each block by ~24px without losing the boundary.
 *   - `scroll-mt` grows so the sticky dashboard header cannot cover a heading
 *     a deep link just jumped to.
 *
 * `tone` is kept for call sites; both branches already resolved to the same
 * tokens, so it is written once.
 */
export function Section({
  id,
  kicker,
  title,
  body,
  children,
  index,
}: {
  id: string;
  kicker: string;
  title: string;
  body: ReactNode;
  children: ReactNode;
  /** 1-based position, rendered as the margin index mark. */
  index?: number;
  tone?: "themed" | "light";
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      /* `min-w-0` is REQUIRED ON THE SECTION ITSELF, not only on its children.

         This section is a grid item of the docs reading column. A grid item's
         `min-width: auto` resolves to its MIN-CONTENT size, and this section's
         min-content is set by the longest unbroken line inside a code block
         (550px). The parent's implicit `auto` column therefore grew to 550px,
         and /docs scrolled 177px sideways on a 390px phone even though
         `min-w-0` was already on every descendant — because each descendant
         competed with an ancestor that had not opted out. Verified by walking
         the computed chain: `section · minWidth: auto · w: 551` inside a
         `358px` column. */
      className="min-w-0 scroll-mt-28 border-t border-border pt-10 first:border-0 first:pt-0"
    >
      <div className="flex items-baseline gap-3">
        {index ? (
          <span
            aria-hidden
            className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground/50"
          >
            {String(index).padStart(2, "0")}
          </span>
        ) : null}
        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {kicker}
        </p>
      </div>

      <h2
        id={`${id}-title`}
        className="mt-2 max-w-[46ch] text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {title}
      </h2>

      <div className="mt-2.5 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        {body}
      </div>

      {/* `grid-cols-[minmax(0,1fr)]`, NOT a bare `grid`.

         A bare `grid` creates one implicit `auto` column, and `auto` sizes to
         max-content — so a single long code line inside a child set the column
         to 527px inside a 358px container, and /docs scrolled 177px sideways
         on a 390px phone. `min-w-0` on the container does NOT fix this: it
         governs the element's own min size, not its track sizing. The track
         itself has to be told it may shrink below its content, which is what
         `minmax(0, 1fr)` does. Verified in the computed chain:
         container 358px, `grid-template-columns: 527px`. */}
      <div className="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {children}
      </div>
    </section>
  );
}
