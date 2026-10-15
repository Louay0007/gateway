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
 * Same copy, same snippets, same anchors on both; only the CTA target
 * and canvas tone adapt via `dashboard`.
 */
export function DocsContent({ dashboard = false }: { dashboard?: boolean }) {
  const [model, setModel] = React.useState("fast");
  const [base, setBase] = React.useState(PUBLIC_BASE_URL);

  return (
    <div className={dashboard ? "" : "light-surface"}>
      <DocsHero dashboard={dashboard} />
      <div className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="gap-10 pt-12 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
          <DocsToc />
          <div className="grid min-w-0 gap-16">
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
