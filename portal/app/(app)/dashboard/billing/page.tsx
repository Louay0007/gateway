import type { Metadata } from "next";

import { BillingView } from "@/components/dashboard/billing-view";

export const metadata: Metadata = { title: "Billing & Subscription" };

/**
 * /dashboard/billing — plan, spend and the way you pay.
 *
 * The heading lives in `BillingView`'s `PageHeader`, beside the refresh and
 * change-plan actions. The shell header already names the page.
 */
export default function BillingPage() {
  return <BillingView />;
}
