/**
 * The docs surface's spatial system — declared once, imported everywhere.
 *
 * WHY A MODULE AND NOT A CLASS STRING PER FILE. /docs is seven sections that
 * must share one vertical line, one measure and one gutter. When each section
 * carried its own `mx-auto max-w-6xl px-4 sm:px-6 lg:px-8`, changing the page
 * width meant finding six copies and keeping them in sync; a single section
 * that disagreed by 8px would break the gutter on every heading below it.
 *
 * THE THESIS. A documentation page on a 2560px monitor has one job for its
 * surplus width: let CODE be wide while PROSE stays readable. Stretching a
 * paragraph to 1600px is not using the width, it is un-reading it. So the
 * scale has four roles, and nothing on the page picks a raw number:
 *
 *   DOCS_WRAP    the page rail — as wide as the viewport honestly allows
 *   DOCS_PROSE   the reading measure — 68ch, never wider
 *   DOCS_GRID    the two-column body: a fixed nav rail, then the content
 *   (breakout)   what a Section's children get: the whole content column, so
 *                figures and tables can be wider than the prose beside them
 *
 * Astryx's layout guide asks for the same thing in different words: "Data
 * views take the full width of their region; text, forms and lists sit in a
 * column capped by contentWidth." That is exactly the breakout vs DOCS_PROSE.
 *
 * These are Tailwind class strings rather than CSS variables on purpose: the
 * rest of the console is Tailwind-first, and a `@theme` token would have to be
 * invented for each breakpoint. The values below ARE the scale — 68ch, 16rem,
 * 4rem — so a new section picks a role instead of a number.
 */

/** The page rail. Full width up to 1680px, generous gutters after that. */
export const DOCS_WRAP =
  "mx-auto w-full max-w-[1680px] px-5 sm:px-8 lg:px-12";

/** The reading measure. Anything a person reads line by line caps here. */
export const DOCS_PROSE = "max-w-[68ch]";

/** Display headings: a shorter measure so lines break where they are designed to. */
export const DOCS_DISPLAY = "max-w-[30ch]";

/**
 * The body grid: nav rail + content.
 *
 * `minmax(0,1fr)` on the content column, not `1fr`. A grid track defaults to
 * `auto`, which sizes to max-content — and here max-content is set by the
 * longest line inside a code block. That is precisely how /docs came to scroll
 * 177px sideways on a 390px phone while every descendant carried `min-w-0`
 * (see docs-section.tsx). The track itself has to be told it may shrink.
 */
export const DOCS_GRID =
  "grid gap-y-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-14 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-x-20";

/**
 * Vertical rhythm. One role, stated once: a section is separated from its
 * neighbours by the wrapper's `gap`, and grouped internally by the heading's
 * own margins. Repeating one value for both is what made the old page read as
 * a single 4000px scroll with no boundaries.
 */
export const DOCS_SECTION = "min-w-0 scroll-mt-28";

/** Hairline that carries section separation instead of a card boundary. */
export const DOCS_RULE = "border-t border-border";

/**
 * The page's sections, in reading order — and the ONE source for the rail's
 * labels, each section's anchor id, and each section's number.
 *
 * WHY ONE LIST. The rail used to carry its own `TOC` array of ids plus a
 * separate `labels` record, while each section declared its id and its
 * `index={n}` by hand in seven files. Adding a section meant editing three
 * places, and forgetting one produced either a rail link that silently went
 * nowhere or — worse, because it is invisible — two sections numbered `05`
 * while the rail counted seven. Here the order IS the data: `sectionNumber()`
 * derives the numeral from a section's position, and the rail derives its
 * whole list from the same array.
 *
 * The order is not arbitrary: quickstart must precede models, which must
 * precede the wire formats. A reader can work the page top to bottom and never
 * need the rail, which is the only justification the craft floor accepts for
 * numbering sections at all.
 */
export const DOCS_SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "models", label: "Models" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "keys", label: "Keys & limits" },
] as const;

export interface DocsSectionItem {
  id: string;
  label: string;
}

/**
 * The 1-based number a section displays, from its position in DOCS_SECTIONS.
 *
 * Returns undefined for an id that is not in the list, so a section added to
 * the page but not to the array renders WITHOUT a number rather than with a
 * wrong one — a missing numeral is a visible bug a reviewer catches, while an
 * off-by-one numeral silently misdescribes the document.
 */
export function sectionNumber(id: string): number | undefined {
  const i = DOCS_SECTIONS.findIndex((section) => section.id === id);
  return i === -1 ? undefined : i + 1;
}
