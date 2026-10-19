import type { Metadata } from "next";

import { SettingsForms } from "@/components/dashboard/settings-forms";

export const metadata: Metadata = { title: "Account Settings" };

export default function SettingsPage() {
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Your profile and your password.
        </p>
      </div>
      <SettingsForms />
    </>
  );
}
