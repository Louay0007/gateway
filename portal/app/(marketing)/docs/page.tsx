import type { Metadata } from "next";

import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { DocsContent } from "@/components/docs/docs-content";

/**
 * The docs TOC renders the live Starter price through the promotion
 * module. Prerendered at build time, that line would freeze on the price
 * of the day the image was built — advertising "35 DT until 1 Nov" months
 * later. Render per request so the window closes on its own.
 */
export const dynamic = "force-dynamic";

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
      <Navbar />
      <main>
        <DocsContent />
      </main>
      <MarketingFooter />
    </>
  );
}
