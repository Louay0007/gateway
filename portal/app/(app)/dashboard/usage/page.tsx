import type { Metadata } from "next";

import { UsageView } from "@/components/dashboard/usage-view";

export const metadata: Metadata = { title: "Usage Analytics" };

/**
 * /dashboard/usage — the ledger.
 *
 * No heading here: the sticky shell header already renders the page title
 * (`titleForPath`), and `UsageView` opens with its own `PageHeader` carrying
 * the lede and the filter actions. A third title would be the third copy of
 * the same word on one screen.
 */
export default function UsagePage() {
  return <UsageView />;
}
