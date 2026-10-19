import type { Metadata } from "next";

import { KeysView } from "@/components/dashboard/keys-view";

export const metadata: Metadata = { title: "API Keys" };

export default function KeysPage() {
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">API keys</h2>
        <p className="text-sm text-muted-foreground">
          Credentials for the OpenAI- and Anthropic-compatible endpoints.
        </p>
      </div>
      <KeysView />
    </>
  );
}
