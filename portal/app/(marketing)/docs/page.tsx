import type { Metadata } from "next";

import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { DocsContent } from "@/components/docs/docs-content";

export const metadata: Metadata = {
  title: "Documentation",
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
      <Navbar />
      <main>
        <DocsContent />
      </main>
      <MarketingFooter />
    </>
  );
}
