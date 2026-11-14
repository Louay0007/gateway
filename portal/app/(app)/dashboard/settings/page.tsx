import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  SettingsPanel,
  movedTab,
  resolveSettingsTab,
} from "@/components/settings/settings-panel";

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

  // A tab that now has its own page forwards there. Without this, an old
  // bookmarked /dashboard/settings?tab=keys would fall through
  // resolveSettingsTab and land on Profile — which looks like the link
  // worked, so nobody would report it.
  const moved = movedTab(Array.isArray(sp.tab) ? sp.tab[0] : sp.tab);
  if (moved) redirect(moved);

  const tab = resolveSettingsTab(sp.tab);

  return (
    // `max-w-5xl`, matching the chat shell's settings page. The console
    // layout deliberately has no max width — Usage and Billing want every
    // pixel — but a settings form stretched across a 2560px monitor puts
    // a 120px label 2000px from its field. The measure belongs to the
    // page, not the group.
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      {/* `h2`: the shell's sticky header already owns the page's `h1`
          (site-header.tsx), so a second `h1` here would be a duplicate
          heading, not a bigger one. */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account: profile, how the model remembers you, and closing
          the account. Plan, usage, keys and billing each have their own page.
        </p>
      </div>
      <SettingsPanel tab={tab} shell="console" />
    </div>
  );
}
