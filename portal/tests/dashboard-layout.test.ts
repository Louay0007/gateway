/**
 * The console's layout contract.
 *
 * WHY THIS EXISTS. Every rule here was a real defect found by reading the
 * seven dashboard pages, and each one is invisible to typecheck and to a
 * happy-path render:
 *
 *   - a page that renders its own `h2` under a shell header that already
 *     renders the page title (two headings, one screen);
 *   - a marketing-scale `h1` inside the signed-in shell;
 *   - the hero-metric template (a grid of bordered stat cards) creeping
 *     back in after the rail replaced it;
 *   - duplicated utility classes from copy-paste edits, which silently
 *     change which one wins.
 *
 * Asserted against the source rather than a render because the failure mode
 * is "someone adds one more card", which no snapshot catches.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORTAL = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(PORTAL, p), "utf8");

const DASHBOARD_PAGES = [
  "app/(app)/dashboard/page.tsx",
  "app/(app)/dashboard/usage/page.tsx",
  "app/(app)/dashboard/keys/page.tsx",
  "app/(app)/dashboard/billing/page.tsx",
  "app/(app)/dashboard/settings/page.tsx",
  "app/(app)/dashboard/redeem/page.tsx",
];

describe("console layout — one title per screen", () => {
  it("no dashboard page renders its own h1", () => {
    // The shell's sticky header owns the page's h1 (`titleForPath`). A page
    // that renders another one gives the document two top-level headings.
    const offenders = DASHBOARD_PAGES.filter((p) => /<h1[\s>]/.test(read(p)));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no dashboard page hard-codes a text-xl page title", () => {
    // The old pattern: `<h2 className="text-xl font-semibold tracking-tight">`.
    // It is what `PageHeader size="console"` renders, so a page that writes
    // it by hand drifts from the shared spacing the moment the header changes.
    const offenders = DASHBOARD_PAGES.filter((p) =>
      /<h2 className="text-xl font-semibold tracking-tight"/.test(read(p)),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no console PageHeader repeats the shell's title", () => {
    // The shell header renders the page title from `titleForPath`. A console
    // `PageHeader` that also passes `title` prints the same word twice, 64px
    // apart — which is exactly what all six pages did before this pass.
    // Console headers carry `lede` + `actions` only.
    const views = [
      "components/dashboard/dashboard-overview.tsx",
      "components/dashboard/usage-view.tsx",
      "components/dashboard/keys-view.tsx",
      "components/dashboard/billing-view.tsx",
      "app/(app)/dashboard/settings/page.tsx",
      "app/(app)/dashboard/redeem/page.tsx",
    ];
    const offenders: string[] = [];
    for (const f of views) {
      const src = read(f);
      for (const m of src.matchAll(/<PageHeader\b[\s\S]*?\/>/g)) {
        if (m[0].includes('size="console"') && /\btitle=/.test(m[0])) {
          offenders.push(f);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("console layout — the metric rail, not stat cards", () => {
  it("the stat-card component is gone", () => {
    // Five bordered boxes with an icon each is the hero-metric template. The
    // rail replaced it; re-adding the component is how it comes back.
    expect(() => read("components/dashboard/stat-card.tsx")).toThrow();
  });

  it("no dashboard view imports a StatCard", () => {
    const views = [
      "components/dashboard/dashboard-overview.tsx",
      "components/dashboard/usage-view.tsx",
      "components/dashboard/billing-view.tsx",
    ];
    const offenders = views.filter((p) => /StatCard/.test(read(p)));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the rail draws its dividers with gap-px over a border surface", () => {
    // The dividers are structural: without `gap-px` + `bg-border` the rail
    // renders as one undifferentiated block and the figures lose their edges.
    const rail = read("components/dashboard/metric-rail.tsx");
    expect(rail).toContain("gap-px");
    expect(rail).toContain("bg-border");
  });
});

describe("console layout — no duplicated utilities", () => {
  it("no component repeats a utility class in one className", () => {
    // `bg-warning/10 bg-warning/10` and `hover:bg-muted hover:bg-primary/80`
    // were both live. The second is worse than redundant: it made the primary
    // CTA flash grey on hover, because the later class won.
    const files = [
      "app/(app)/layout.tsx",
      "app/(app)/dashboard/redeem/page.tsx",
      "components/trial/redeem-form.tsx",
      "components/dashboard/plan-card.tsx",
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/className="([^"]+)"/g)) {
        const classes = m[1]!.split(/\s+/).filter(Boolean);
        const dupes = classes.filter((c, i) => classes.indexOf(c) !== i);
        if (dupes.length > 0) offenders.push(`${f}: ${[...new Set(dupes)].join(", ")}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("console layout — the docs hero adapts to the shell", () => {
  it("renders a console-scale heading when mounted in the dashboard", () => {
    // The same component serves public /docs (marketing scale) and
    // /dashboard/docs (console scale). Without the branch, the console page
    // opened with a 68px masthead under a 16px sticky header.
    const hero = read("components/docs/docs-hero.tsx");
    expect(hero).toContain("dashboard ?");
    expect(hero).toContain("text-2xl");
  });
});
