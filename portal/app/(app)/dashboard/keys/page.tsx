import type { Metadata } from "next";

import { KeysView } from "@/components/dashboard/keys-view";

export const metadata: Metadata = { title: "API Keys" };

/**
 * /dashboard/keys — the credential manager.
 *
 * The heading lives in `KeysView`'s `PageHeader`, beside the create action.
 * The shell header already names the page; a second `h2` here would repeat
 * it with no action attached to it.
 */
export default function KeysPage() {
  return <KeysView />;
}
