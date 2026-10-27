import type { Metadata } from "next";

import {
  AdminHeader,
  AdminPage,
  AdminSection,
  AdminStat,
} from "@/components/admin/stat-card";
import { PlanManager } from "@/components/admin/plan-manager";
import { listPlansAdmin } from "@/lib/admin/plans";
import { staffAtLeast, type StaffRole } from "@/lib/auth/authorize";
import { currentStaffRole } from "@/lib/auth/authorize";

export const metadata: Metadata = { title: "Subscription Plans" };
export const dynamic = "force-dynamic";

/**
 * /admin/plans — the catalog editor.
 *
 * `plans` had ZERO insert/update/delete in application code before this:
 * the only writers were migration 0003 and whatever an operator typed
 * into psql. That made the three levers that define the business —
 * `price_cents`, `rate_multiplier_bps`, `hard_cap_cents` — editable only
 * by hand-editing rows against a live database.
 *
 * OWNER-GATED, not admin. `admin` can suspend an account or record a
 * refund for ONE customer. A plan edit moves money for every customer on
 * it, and changes what every future customer buys. That is one tier up,
 * deliberately.
 */
export default async function AdminPlansPage() {
  const role = (await currentStaffRole()) as StaffRole;
  const plans = await listPlansAdmin();
  const canEdit = role !== null && staffAtLeast(role, "owner");

  const live = plans.filter((p) => p.public);
  const cheapest = live.length > 0 ? Math.min(...live.map((p) => p.rateMultiplierBps)) : null;
  const subscribers = plans.reduce((a, p) => a + p.subscriberCount, 0);

  return (
    <AdminPage>
      <AdminHeader
        title="Plans"
        description="The catalog. These rows are the only entitlement truth — a key's limits and budget come from the plan it is on."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat label="Plans" value={plans.length} hint={`${live.length} published`} />
        <AdminStat
          label="Lowest multiplier"
          value={cheapest === null ? null : `${(cheapest / 10000).toFixed(2)}×`}
          hint={
            cheapest !== null && cheapest < 12000
              ? "Below 1.20 — you are subsidising your heaviest users"
              : "Margin-safe"
          }
          tone={cheapest !== null && cheapest < 12000 ? "warning" : "positive"}
        />
        <AdminStat
          label="Subscriptions"
          value={subscribers}
          hint="Live across every plan"
        />
      </dl>

      <div className="mt-8">
        <AdminSection
          title="Catalog"
          description="Retiring hides a plan from the pricing page without touching live subscriptions. A plan with subscribers cannot be retired."
        >
          <PlanManager plans={plans} canEdit={canEdit} />
        </AdminSection>
      </div>
    </AdminPage>
  );
}