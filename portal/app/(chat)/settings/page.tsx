import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResendVerification } from "@/components/auth/verify-email-forms";
import { SettingsPanel, resolveSettingsTab } from "@/components/settings/settings-panel";
import { currentUser } from "@/lib/auth/authorize";
import { isEmailVerified } from "@/lib/auth/verify-email";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * /settings — the settings page, in the chat shell.
 *
 * The body is `SettingsPanel`, shared verbatim with `/dashboard/settings`,
 * so the two shells cannot drift into two different settings pages. See
 * that component for why `?tab=` rather than local state.
 *
 * The guard is the layout's, repeated: a page rendered outside the group
 * (or during a revalidation that skips the layout) must still refuse an
 * anonymous request rather than render an empty shell.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const sp = await searchParams;
  const tab = resolveSettingsTab(sp.tab);
  const verified = await isEmailVerified(user.id);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your plan, usage, keys and account — in one place.
          </p>
        </div>

        {!verified ? (
          <Card className="mb-6 border-warning/30">
            <CardHeader>
              <CardTitle className="text-base">Confirm your email address</CardTitle>
              <CardDescription>
                Keys and subscriptions need a confirmed address. We last mailed{" "}
                {user.email}.
              </CardDescription>
            </CardHeader>
            <CardContent className="sm:max-w-xs">
              <ResendVerification />
            </CardContent>
          </Card>
        ) : null}

        <SettingsPanel tab={tab} shell="chat" />
      </div>
    </div>
  );
}
