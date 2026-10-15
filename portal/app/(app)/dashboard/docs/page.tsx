import type { Metadata } from "next";

import { DocsContent } from "@/components/docs/docs-content";

export const metadata: Metadata = { title: "Docs" };

/**
 * /dashboard/docs — the same integration guide, inside the product
 * shell. The CTA points at the keys page (the reader is authed), and
 * the intro assumes a signed-in customer. No separate copy to drift.
 */
export default function DashboardDocsPage() {
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Docs</h2>
        <p className="text-sm text-muted-foreground">
          Snippets, tiers, and agent configs — copy-paste ready for your keys.
        </p>
      </div>
      <div className="-m-4 sm:-m-6">
        <DocsContent dashboard />
      </div>
    </>
  );
}
