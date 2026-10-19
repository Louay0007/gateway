import type { Metadata } from "next";

import { BillingView } from "@/components/dashboard/billing-view";

export const metadata: Metadata = { title: "Billing & Subscription" };

export default function BillingPage() {
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Billing</h2>
        <p className="text-sm text-muted-foreground">
          Your plan, this period&apos;s spend, and the way you pay.
        </p>
      </div>
      <BillingView />
    </>
  );
}
