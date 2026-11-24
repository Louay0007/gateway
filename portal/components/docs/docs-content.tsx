"use client";

import * as React from "react";

import { DocsHero, DocsToc } from "@/components/docs/docs-hero";
import { Quickstart } from "@/components/docs/docs-quickstart";
import { ModelsSection } from "@/components/docs/docs-models";
import { AnthropicSection, OpenAISection } from "@/components/docs/docs-wire";
import { CodexSection } from "@/components/docs/docs-codex";
import { ClaudeCodeSection } from "@/components/docs/docs-claude";
import { KeysLimitsSection } from "@/components/docs/docs-keys";
import { PUBLIC_BASE_URL } from "@/components/docs/docs-data";

/**
 * DocsContent — the shared body for public /docs and /dashboard/docs.
 * Same copy, same snippets, same anchors on both; only the CTA target and
 * canvas tone adapt via `dashboard`.
 *
 * LAYOUT. A 220px sticky TOC and a reading column that is deliberately NARROW
 * relative to the page container: prose at 62ch and code blocks that can grow
 * wider than the text. The old grid let the content column run to 1280px,
 * which put a 120-character code line and a 400-character paragraph at the
 * same width — one of them was always wrong.
 */
export function DocsContent({ dashboard = false }: { dashboard?: boolean }) {
  const [model, setModel] = React.useState("fast");
  const [base, setBase] = React.useState(PUBLIC_BASE_URL);

  return (
    <div>
      <DocsHero dashboard={dashboard} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        {/* BOTH THE WRAPPER AND THE COLUMN NEED `min-w-0`.

            The wrapper becomes a two-column grid at `lg`, and its right column
            is itself a grid. A grid item defaults to `min-width: auto`, which
            refuses to shrink below its widest content — and here the widest
            content is a code line inside the quickstart. Without `min-w-0` on
            both levels, the chain resolves to max-content and /docs scrolled
            177px sideways on a 390px phone. The `pre` inside CodeBlock can
            only scroll if every ancestor above it agrees to be narrower than
            its content. */}
        <div className="min-w-0 gap-12 pt-12 lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
          <DocsToc />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
            <Quickstart model={model} setModel={setModel} base={base} setBase={setBase} />
            <ModelsSection />
            <OpenAISection model={model} base={base} />
            <AnthropicSection model={model} base={base} />
            <CodexSection />
            <ClaudeCodeSection />
            <KeysLimitsSection dashboard={dashboard} />
          </div>
        </div>
      </div>
    </div>
  );
}
