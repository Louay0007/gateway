import Link from "next/link";

import { TabsContent } from "@/components/ui/tabs";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import {
  DangerCard,
  PasswordCard,
  ProfileCard,
} from "@/components/dashboard/settings-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatSettings } from "@/components/chat/chat-settings";
import { InstructionsPanel, MemoryPanel } from "@/components/chat/memory-panel";

/**
 * SettingsPanel — the one settings body, rendered by BOTH shells.
 *
 * There used to be two settings pages: this six-tab one under `/settings`,
 * and a `/dashboard/settings` page that was `ProfileCard` + `PasswordCard`
 * + `DangerCard` and nothing else. Two pages meant two answers to "where
 * do I change my password", and the console's answer silently lacked plan,
 * usage and API keys. The components were already shared; only the page
 * was duplicated.
 *
 * So the page is shared too. Both routes render this, each inside its own
 * shell, and `?tab=` is the source of truth in both — every panel here is
 * a link target from somewhere else (the 402 in chat points at
 * `?tab=plan`, the header's key button at `?tab=keys`), and a tab that
 * resets on refresh breaks those flows.
 *
 * `shell` decides only the footer link: a customer in the console is
 * offered the way into chat and vice versa. It is not a layout switch —
 * the shell comes from the route group.
 */
/**
 * SETTINGS OWNS ACCOUNT-LEVEL THINGS ONLY.
 *
 * WHY THIS SHRANK. It used to carry seven tabs, and three of them — plan,
 * usage, keys, billing — rendered the SAME components as the standalone
 * pages in the sidebar (`BillingView`, `UsageView`, `KeysView`,
 * `PaymentHistory`). That is the same page at two URLs: two places to fix a
 * bug, two back-button entries, and a sidebar where clicking "Usage" and
 * clicking Settings → Usage gave different chrome for identical content.
 *
 * The rule now: if it has its own sidebar destination, it does not also get
 * a settings tab.
 *
 *   sidebar            settings tab
 *   Overview           —
 *   Usage              —
 *   API keys           —
 *   Billing            —        (the plan tab redirects here)
 *   Docs               —
 *                      Profile   account details + password
 *                      AI        memories + custom instructions
 *                      Danger    delete account
 *
 * `/dashboard/settings?tab=plan|usage|keys|billing` still RESOLVES — the
 * chat sidebar, the quota hint and the D17 return URL all link there — but
 * it forwards to the real page instead of rendering a second copy.
 */
const TABS = [
  "profile",
  // Personalisation: the model's settings about YOU, kept apart from
  // "profile" (account details) and from "keys" (secrets). A memory tab
  // buried under Profile is a tab nobody finds, and the audit's trust
  // requirement is that the list is discoverable as well as deletable.
  "ai",
  "danger",
] as const;

/**
 * Tabs that USED to exist here and now have their own page.
 *
 * Resolved before TABS so an old link lands on the real destination rather
 * than silently falling back to Profile — which is what a strict
 * `TABS.includes` check would do, and it would look like the link worked.
 */
const MOVED_TO_PAGE: Record<string, string> = {
  plan: "/dashboard/billing",
  billing: "/dashboard/billing",
  usage: "/dashboard/usage",
  keys: "/dashboard/keys",
};
export type SettingsTab = (typeof TABS)[number];

/**
 * Where a retired settings tab now lives, or null when it is a real tab.
 *
 * INFORMATIONAL — the forwarding itself is `redirects()` in next.config.ts.
 * A page-level redirect() in a streamed server render answers 200 with a
 * client-side meta tag, which no crawler, curl or fetch follows, so the
 * config is the only place it actually works. This map exists so the two
 * lists can be compared by hand and by test.
 */
export function movedTab(value: string | undefined): string | null {
  if (!value) return null;
  return MOVED_TO_PAGE[value] ?? null;
}

/** Unknown or absent `?tab=` falls back to plan, never to an empty page. */
export function resolveSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Default is `profile`: the old default was `plan`, which now has its own
  // page, so falling back to it would mean a redirect out of Settings.
  return (TABS as readonly string[]).includes(value ?? "") ? (value as SettingsTab) : "profile";
}

export function SettingsPanel({
  tab,
  shell,
}: {
  tab: SettingsTab;
  shell: "chat" | "console";
}) {
  return (
    <>
      <SettingsTabs tab={tab}>
        {/* One consistent rhythm for every panel: the same 1rem stack,
            and a readable measure inside cards (`max-w-2xl` on the panel
            container would fight the tables in Usage/Billing, which want
            the full width — so each card narrows itself instead). */}
        {/* `usage`, `keys`, `billing` and `plan` moved to their own pages —
            see MOVED_TO_PAGE. Rendering them here as well would be the
            duplication this change exists to remove. */}

        <TabsContent value="profile" className="grid gap-4 sm:gap-6">
          <ProfileCard />
          <PasswordCard />
          <ChatSettings />
        </TabsContent>

        <TabsContent value="ai" className="grid gap-4 sm:gap-6">
          <MemoryPanel />
          <InstructionsPanel />
        </TabsContent>

        <TabsContent value="danger">
          <DangerCard />
        </TabsContent>
      </SettingsTabs>

      <p className="mt-8 text-xs text-muted-foreground">
        {shell === "chat" ? (
          <>
            Need your API keys for a script?{" "}
            <Link href="/dashboard/keys" className="underline underline-offset-4">
              Open the keys page
            </Link>
            .
          </>
        ) : (
          <>
            Want to talk to a model?{" "}
            <Link href="/chat" className="underline underline-offset-4">
              Open chat
            </Link>
            .
          </>
        )}
      </p>
    </>
  );
}
