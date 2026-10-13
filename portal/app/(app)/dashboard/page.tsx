import type { Metadata } from "next";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

export const metadata: Metadata = { title: "Overview" };

/**
 * /dashboard — a shell. The data lives in `DashboardOverview` because it
 * is fetched client-side from `/api/subscription` and `/api/keys`, and a
 * server component cannot hand a promise to a client component.
 */
export default function DashboardPage() {
  return <DashboardOverview />;
}