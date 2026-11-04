import type { Metadata } from "next";

import { SettingsPanel, resolveSettingsTab } from "@/components/settings/settings-panel";

export const metadata: Metadata = { title: "Account Settings" };
export const dynamic = "force-dynamic";

/**
 * /dashboard/settings — the settings page, in the console shell.
 *
 * Renders the SAME `SettingsPanel` as `/settings`. It used to render
 * `SettingsForms` (profile, password, danger) and nothing else, so the
 * console's answer to "where do I change my password" was a page that
 * silently lacked plan, usage and API keys.
 *
 * The guard is the (app) layout's — it already redirects an anonymous
 * request to /sign-in, so repeating `currentUser()` here would be a second
 * database read per render for the same answer.
 *
 * `?tab=` works here too, so a link written for one shell keeps working in
 * the other.
 */
export default async function DashboardSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = resolveSettingsTab(sp.tab);

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Your plan, usage, keys and account — in one place.
        </p>
      </div>
      <SettingsPanel tab={tab} shell="console" />
    </>
  );
}
