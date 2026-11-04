import type { Metadata } from "next";
import Link from "next/link";

import { hasLiveSession } from "@/lib/auth/authorize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zaino AI",
  description: "One API for every model.",
};

/**
 * `/` — INTERIM. The marketing landing page and the whole dashboard group
 * were removed by the web-chat restructure (plans/web-chat-restructure.md).
 *
 * This page exists only so the tree has a root: without it `/` is a 404 and
 * `/sign-in` (which bounces a live session to `/`) turns into a redirect
 * loop. Phase 1 of the plan replaces this file with the chat app.
 *
 * Deliberately no session-based redirect: a signed-in visitor must not be
 * sent to `/sign-in` from here, and there is no chat route to send them to
 * yet.
 */
export default async function RootPage() {
  const signedIn = await hasLiveSession();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Zaino AI</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The web app is being rebuilt as a chat product — sign in, chat, and
        manage your plan and usage in one place.
      </p>
      <p className="text-sm">
        {signedIn ? (
          <Link href="/sign-in" className="underline underline-offset-4">
            Continue to your account
          </Link>
        ) : (
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        )}
      </p>
    </main>
  );
}
