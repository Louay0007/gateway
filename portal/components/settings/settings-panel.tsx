import Link from "next/link";

import { TabsContent } from "@/components/ui/tabs";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { BillingView, PaymentHistory } from "@/components/dashboard/billing-view";
import { KeysView } from "@/components/dashboard/keys-view";
import { UsageView } from "@/components/dashboard/usage-view";
import {
  DangerCard,
  PasswordCard,
  ProfileCard,
} from "@/components/dashboard/settings-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RedeemForm } from "@/components/trial/redeem-form";
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
const TABS = [
  "plan",
  "usage",
  "keys",
  "billing",
  "profile",
  // Personalisation: the model's settings about YOU, kept apart from
  // "profile" (account details) and from "keys" (secrets). A memory tab
  // buried under Profile is a tab nobody finds, and the audit's trust
  // requirement is that the list is discoverable as well as deletable.
  "ai",
  "danger",
] as const;
export type SettingsTab = (typeof TABS)[number];

/** Unknown or absent `?tab=` falls back to plan, never to an empty page. */
export function resolveSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (TABS as readonly string[]).includes(value ?? "") ? (value as SettingsTab) : "plan";
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
        <TabsContent value="plan" className="grid gap-4 sm:gap-6">
          <BillingView />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Have a trial code?</CardTitle>
              <CardDescription>
                Redeem it here rather than on a separate page — it is one
                input, and a whole route for one input is a dead end.
              </CardDescription>
            </CardHeader>
            <CardContent className="sm:max-w-sm">
              <RedeemForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage">
          <UsageView />
        </TabsContent>

        <TabsContent value="keys">
          <KeysView />
        </TabsContent>

        <TabsContent value="billing" className="grid gap-4 sm:gap-6">
          <PaymentHistory />
          <p className="max-w-prose text-sm text-muted-foreground">
            Pay by D17 transfer (La Poste Tunisienne — manual verification) or
            by card worldwide through Dodo. The plan tab shows both before any
            checkout.
          </p>
        </TabsContent>

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
            <Link href="/dashboard/settings?tab=keys" className="underline underline-offset-4">
              Open them in the dashboard
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
