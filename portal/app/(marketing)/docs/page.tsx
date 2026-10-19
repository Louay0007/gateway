import type { Metadata } from "next";

import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { DocsContent } from "@/components/docs/docs-content";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "First request in two minutes: OpenAI- and Anthropic-compatible snippets, the three model tiers, and exact Codex and Claude Code configs for Zaino.",
};

/**
 * /docs — the public integration guide. Anonymous; every CTA funnels
 * to sign-up. The same body renders inside the dashboard at
 * /dashboard/docs with the CTA retargeted at the keys page.
 */
export default function DocsPage() {
  return (
    <>
      {/* light-surface pins the light tokens over the navbar's hardcoded
          `dark` class (declared later in globals.css, equal specificity,
          so it wins in this subtree) — otherwise the nav text renders
          white on this page's white canvas. */}
      <div className="light-surface">
        <Navbar tone="light" />
      </div>
      <main>
        <DocsContent />
      </main>
      <MarketingFooter />
    </>
  );
}
