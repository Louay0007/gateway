import type { Metadata } from "next";

import { DocsContent } from "@/components/docs/docs-content";

export const metadata: Metadata = { title: "API Documentation" };

/**
 * /dashboard/docs — the same integration guide, inside the product
 * shell. No local header: DocsContent already renders the hero, so a
 * second title here duplicated it. CTA points at the keys page.
 */
export default function DashboardDocsPage() {
  return <DocsContent dashboard />;
}
