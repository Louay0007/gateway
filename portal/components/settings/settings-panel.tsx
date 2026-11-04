import Link from "next/link";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <Tabs defaultValue={tab}>
        <TabsList className="mb-2 w-full overflow-x-auto">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="danger">Danger</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="grid gap-4">
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

        <TabsContent value="billing" className="grid gap-4">
          <PaymentHistory />
          <p className="text-sm text-muted-foreground">
            Payments are manual D17 transfers (La Poste Tunisienne). Your
            plan tab opens the checkout with the transfer instructions.
          </p>
        </TabsContent>

        <TabsContent value="profile" className="grid gap-4">
          <ProfileCard />
          <PasswordCard />
          <ChatSettings />
        </TabsContent>

        <TabsContent value="ai" className="grid gap-4">
          <MemoryPanel />
          <InstructionsPanel />
        </TabsContent>

        <TabsContent value="danger">
          <DangerCard />
        </TabsContent>
      </Tabs>

      <p className="mt-8 text-xs text-muted-foreground">
        {shell === "chat" ? (
          <>
            Need your API keys for a script?{" "}
            <Link href="/dashboard" className="underline underline-offset-4">
              Open the classic dashboard
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
