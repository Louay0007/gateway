"use client";

import * as React from "react";

import { DocsCta, DocsHero } from "@/components/docs/docs-hero";
import { DocsRail } from "@/components/docs/docs-rail";
import { Quickstart } from "@/components/docs/docs-quickstart";
import { ModelsSection } from "@/components/docs/docs-models";
import { AnthropicSection, OpenAISection } from "@/components/docs/docs-wire";
import { CodexSection } from "@/components/docs/docs-codex";
import { ClaudeCodeSection } from "@/components/docs/docs-claude";
import { KeysLimitsSection } from "@/components/docs/docs-keys";
import { PUBLIC_BASE_URL } from "@/components/docs/docs-data";
import { DOCS_GRID, DOCS_SECTIONS, DOCS_WRAP } from "@/components/docs/docs-layout";

/**
 * DocsContent — the shared body for public /docs and /dashboard/docs.
 * Same copy, same snippets, same anchors on both; only the CTA target and
 * canvas tone adapt via `dashboard`.
 *
 * THE GRID. A sticky 13–16rem rail and a content column that takes everything
 * else, inside a 1680px page rail. The content column is `minmax(0,1fr)` for
 * the reason recorded in docs-section.tsx: an `auto` track sizes to the longest
 * code line and grows the page past the viewport.
 *
 * THE READING COLUMN IS NARROWER THAN THE CONTENT COLUMN, ON PURPOSE. Prose
 * caps at 68ch (DOCS_PROSE, applied inside every Section); code, tables and
 * figures take the column's full width. That split is the whole reason the page
 * can be this wide — a 120-character code line and a 400-character paragraph
 * never share a right edge, which is precisely what the old 1280px grid got
 * wrong in the opposite direction.
 *
 * ONE LIST DRIVES THE RAIL AND THE NUMBERS. `DOCS_SECTIONS` holds the order;
 * the rail renders it and each Section derives its numeral from its own
 * position in it. A section added here gets an anchor, a rail entry and the
 * right number, or it gets none of them — never a stale `index={5}`.
 */
export function DocsContent({ dashboard = false }: { dashboard?: boolean }) {
  const [model, setModel] = React.useState("fast");
  const [base, setBase] = React.useState(PUBLIC_BASE_URL);

  return (
    <div>
      <DocsHero dashboard={dashboard} />

      <div className={DOCS_WRAP}>
        <div className={DOCS_GRID}>
          <DocsRail items={DOCS_SECTIONS} dashboard={dashboard} />

          {/* `gap-14` between sections, `mt-3` inside one. Two values for two
              different relationships: adjacent topics are separated generously,
              a heading and its lede are bound tightly. Using one interval for
              both is what made the old page a single undifferentiated scroll. */}
          <article className="min-w-0 py-14 sm:py-16">
            <div className="grid gap-14 sm:gap-16">
              <Quickstart model={model} setModel={setModel} base={base} setBase={setBase} />
              <ModelsSection />
              <OpenAISection model={model} base={base} />
              <AnthropicSection model={model} base={base} />
              <CodexSection />
              <ClaudeCodeSection />
              <KeysLimitsSection dashboard={dashboard} />
            </div>

            <div className="mt-16">
              <DocsCta dashboard={dashboard} />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
