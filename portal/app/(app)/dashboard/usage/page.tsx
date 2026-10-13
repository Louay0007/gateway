import type { Metadata } from "next";

import { UsageView } from "@/components/dashboard/usage-view";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Every metered request against your account, aggregated from the ledger.
        </p>
      </div>
      <UsageView />
    </>
  );
}
