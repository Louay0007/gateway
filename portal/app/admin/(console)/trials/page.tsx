import type { Metadata } from "next";

import { AdminHeader, AdminPage, AdminSection, AdminStat } from "@/components/admin/stat-card";
import { TrialManager } from "@/components/admin/trial-manager";
import { currentStaffRole, staffAtLeast } from "@/lib/auth/authorize";
import { listTrialCodes } from "@/lib/admin/trials";

export const metadata: Metadata = { title: "Trial Campaigns" };
export const dynamic = "force-dynamic";

/**
 * /admin/trials — campaign codes and who used them.
 *
 * OWNER-GATED for writes, like the plan catalog: a code is money with no
 * customer attached, so a mistake costs revenue across everyone who redeems it.
 * Reads are open to any staff role.
 *
 * The redemption COUNT is what makes this useful — a campaign nobody redeemed
 * is a campaign to stop, and that question could not be asked before.
 */
export default async function AdminTrialsPage() {
  const [codes, role] = await Promise.all([listTrialCodes(), currentStaffRole()]);
  const canManage = role !== null && staffAtLeast(role, "owner");

  const live = codes.filter((c) => c.active).length;
  const totalRedemptions = codes.reduce((a, c) => a + c.liveRedemptions, 0);

  return (
    <AdminPage>
      <AdminHeader
        title="Trials"
        description="Promotional codes. Redeeming one attaches the account to the hidden trial plan for the code's window."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <AdminStat label="Codes" value={codes.length} hint="All time, including retired" />
        <AdminStat label="Live" value={live} hint="Currently accepting redemptions" />
        <AdminStat
          label="Redemptions"
          value={totalRedemptions}
          hint="Counted from the redemption rows, not the cached column"
          tone={totalRedemptions > 0 ? "positive" : "neutral"}
        />
      </dl>

      <div className="mt-8">
        <AdminSection
          title="Codes"
          description="Deactivating refuses new redemptions and keeps the history — a code is never deleted, because its redemptions reference it."
        >
          <TrialManager
            codes={codes.map((c) => ({
              id: c.id,
              code: c.code,
              trialDays: c.trialDays,
              maxRedemptions: c.maxRedemptions,
              redeemedCount: c.redeemedCount,
              liveRedemptions: c.liveRedemptions,
              models: c.models,
              validUntil: c.validUntil,
              active: c.active,
            }))}
            canManage={canManage}
          />
        </AdminSection>
      </div>
    </AdminPage>
  );
}
