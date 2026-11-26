import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { DOCS_PROSE, DOCS_SECTION, sectionNumber } from "@/components/docs/docs-layout";

/**
 * Section — the docs page's repeating unit, rebuilt around a hanging index.
 *
 * THE PROBLEM IT SOLVES. Seven sections each carrying a kicker + title + lede +
 * content grid, all with the same interval, read as one long scroll with no
 * boundaries. Worse, the old markup kept the kicker ABOVE the heading as an
 * eyebrow — which the craft floor bans outright: the heading carries its own
 * weight and a label above it is scaffolding dressed as design.
 *
 * THE SHAPE NOW IS A TWO-ZONE SECTION, and the page's width is what makes it
 * work:
 *
 *   01 │ Wire format          ← standfirst names the kind of section
 *      │ OpenAI-compatible chat
 *      │ Lede at the reading measure, 68ch
 *      │
 *      │ ┌ code / tables break out to the full content column ┐
 *
 * The number hangs in the margin and sticks with the heading down its whole
 * height, so a reader scrolling at speed sees the document's structure in the
 * left gutter even with the body text blurred.
 *
 * THE NUMBER IS DERIVED, NOT PASSED. It comes from the section's position in
 * `DOCS_SECTIONS`, which is also what the rail renders — so the gutter, the
 * rail and the anchors cannot disagree. It is `aria-hidden`: a screen reader
 * gets the heading, not "zero one".
 */
export function Section({
  id,
  kicker,
  title,
  body,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  body: ReactNode;
  children: ReactNode;
}) {
  const number = sectionNumber(id);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      /* `min-w-0` is REQUIRED ON THE SECTION ITSELF, not only on its children.
         This section is a grid item of the docs reading column. A grid item's
         `min-width: auto` resolves to its MIN-CONTENT size, and this section's
         min-content is set by the longest unbroken line inside a code block
         (550px). The parent's implicit column therefore grew to 550px and
         /docs scrolled sideways on a phone even though `min-w-0` was already
         on every descendant — because each descendant competed with an
         ancestor that had not opted out. */
      className={cn(
        DOCS_SECTION,
        "grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-[2.5rem_minmax(0,1fr)]",
      )}
    >
      {/* The index column exists on every section, empty or not, so that all
          seven headings share one x — a conditional column would shift the
          whole page by 2.5rem for any section that omitted its number. */}
      <div aria-hidden className="hidden pt-1 sm:block">
        {number ? (
          <span className="sticky top-20 block font-mono text-[0.6875rem] font-medium tabular-nums text-muted-foreground/50">
            {String(number).padStart(2, "0")}
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        {/* Not an eyebrow over the heading: it names the KIND of section
            (Quickstart, Wire format, Agent CLI), which the title alone does
            not. */}
        <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {kicker}
        </p>

        <h2
          id={`${id}-title`}
          className="mt-3 max-w-[34ch] text-balance text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[2rem] sm:leading-[1.15]"
        >
          {title}
        </h2>

        <div
          className={cn(
            DOCS_PROSE,
            "mt-3 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]",
          )}
        >
          {body}
        </div>

        {/* THE BREAKOUT — full content-column width, unlike the prose above it.
            That split is the entire reason the page can be 1680px wide: a
            120-character code line and a 400-character paragraph never share a
            right edge.

            `minmax(0,1fr)`, not a bare `grid`: a bare grid creates one implicit
            `auto` column sized to max-content, so a single long code line set
            the column to 527px inside a 358px container. The track has to be
            told it may shrink below its content — `min-w-0` on the container
            governs its own min size, not its track sizing. */}
        <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
      </div>
    </section>
  );
}
