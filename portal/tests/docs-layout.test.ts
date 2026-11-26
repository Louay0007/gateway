/**
 * Docs structure — the /docs surface's own guards.
 *
 * WHY THIS FILE EXISTS. `/docs` is the page a developer reads immediately
 * before deciding whether to trust the meter, and it is the one marketing
 * surface whose structure is load-bearing rather than cosmetic: the rail's
 * anchors, the section numerals and the section order must agree, or a deep
 * link lands nowhere and the page's own numbering lies. Those are structural
 * facts and they are assertable without a DOM — this repo runs vitest with
 * `environment: 'node'`, so a render test is not an option.
 *
 * The prose/measure rules are here too because they are the part of the layout
 * a future edit is most likely to undo: widening the reading column back to the
 * content column is a one-line change that looks harmless in review and makes
 * a 400-character paragraph unreadable on a desktop monitor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DOCS_SECTIONS, sectionNumber, DOCS_PROSE, DOCS_WRAP } from "@/components/docs/docs-layout";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("docs — one list drives the rail and the numerals", () => {
  it("numbers every section from its position, 1-based and gapless", () => {
    const numbers = DOCS_SECTIONS.map((s) => sectionNumber(s.id));
    expect(numbers).toEqual(DOCS_SECTIONS.map((_, i) => i + 1));
  });

  it("returns undefined for an id it does not know", () => {
    // A section added to the page but not to the list renders WITHOUT a number
    // rather than with a wrong one — a visible bug beats a silent one.
    expect(sectionNumber("not-a-section")).toBeUndefined();
  });

  it("keeps the published anchor ids stable — they are linked from support mail", () => {
    // These strings are contract: the dashboard's ⌘K menu, the changelog and
    // every reply a human has ever sent point at them.
    expect(DOCS_SECTIONS.map((s) => s.id)).toEqual([
      "quickstart",
      "models",
      "openai",
      "anthropic",
      "codex",
      "claude-code",
      "keys",
    ]);
  });

  it("has a unique id and a unique label for every section", () => {
    const ids = DOCS_SECTIONS.map((s) => s.id);
    const labels = DOCS_SECTIONS.map((s) => s.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("docs — the layout system is declared once", () => {
  it("caps prose at a readable measure", () => {
    // 65–75ch is the craft floor's body measure. Anything wider and the eye
    // loses the line return on a 2560px monitor.
    const ch = Number(DOCS_PROSE.match(/max-w-\[(\d+)ch\]/)?.[1]);
    expect(Number.isFinite(ch)).toBe(true);
    expect(ch).toBeGreaterThanOrEqual(65);
    expect(ch).toBeLessThanOrEqual(75);
  });

  it("uses the width: the page rail is wider than the old 6xl container", () => {
    // max-w-6xl is 72rem. The page was a narrow ribbon on a desktop monitor;
    // asserting the rail is wider than it keeps a future edit from quietly
    // reverting the redesign to the container it replaced.
    const rem = Number(DOCS_WRAP.match(/max-w-\[(\d+)px\]/)?.[1]);
    expect(Number.isFinite(rem)).toBe(true);
    expect(rem).toBeGreaterThan(1152);
  });

  it("no docs component re-types its own page container", () => {
    // The regression this prevents: one section with its own
    // `mx-auto max-w-*` breaks the shared gutter for every heading below it,
    // and the drift is invisible until someone measures.
    const files = [
      "components/docs/docs-hero.tsx",
      "components/docs/docs-content.tsx",
      "components/docs/docs-section.tsx",
      "components/docs/docs-models.tsx",
      "components/docs/docs-keys.tsx",
      "components/docs/docs-wire.tsx",
      "components/docs/docs-codex.tsx",
      "components/docs/docs-claude.tsx",
      "components/docs/docs-quickstart.tsx",
    ];
    const offenders = files.filter((f) => /max-w-6xl|max-w-7xl|max-w-5xl/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("docs — craft floor", () => {
  it("keeps every tier rate out of a card", () => {
    // The models block was sixteen rounded containers for twelve numbers read
    // across. Dense comparison data belongs in rows; a regression to cards is
    // the exact thing this asserts against.
    const models = read("components/docs/docs-models.tsx");
    expect(models).toContain("<table");
    expect(models).toContain("<caption");
    expect(models).not.toMatch(/rounded-(2xl|3xl)/);
  });

  it("does not use a sidebar accent bar on the rail", () => {
    // A coloured `border-l` on a nav row is the "side-tab" tell the design
    // detector flags; the rail marks position with weight and ink instead.
    const rail = read("components/docs/docs-rail.tsx");
    expect(rail).not.toMatch(/border-l-\d|border-l\b/);
  });

  it("keeps the reading column narrower than a breakout figure", () => {
    // Code and tables must be allowed to exceed the prose measure: that split
    // is the only honest justification for a page this wide.
    const section = read("components/docs/docs-section.tsx");
    expect(section).toContain("DOCS_PROSE");
    expect(section).toMatch(/grid-cols-\[minmax\(0,1fr\)\]/);
  });
});
