import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { MailWarning } from "lucide-react";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SearchPalette } from "@/components/chat/conversation-search";
import { ChatHeader } from "@/components/chat/chat-header";
import { ShellIdentityProvider } from "@/components/dashboard/shell-identity";
import { ResendVerification } from "@/components/auth/verify-email-forms";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { currentStaffRole, currentUser } from "@/lib/auth/authorize";
import { ensureSessionReady } from "@/lib/auth/provision";
import { isEmailVerified } from "@/lib/auth/verify-email";

/**
 * (chat) — the signed-in chat product shell.
 *
 * A route group of its own (not `(app)`) so the conversation owns the
 * viewport: the composer sits at the bottom edge and `/settings` scrolls
 * independently. The restored `(app)`/dashboard group is untouched and
 * still served — this is additive, nothing was moved or deleted.
 *
 * The guard is the restored (app) layout's, verbatim in behaviour. Each
 * piece is load-bearing:
 *
 *   currentUser() → /sign-in   without it an anonymous request renders
 *                              the whole shell and every client fetch
 *                              401s into a permanent "Loading…".
 *   ensureSessionReady()       provisions the personal org on the FIRST
 *                              authenticated render, before the client
 *                              fires its parallel /api/orgs +
 *                              /api/subscription reads. Skipping it races
 *                              a cold first load into two orgs.
 *   isEmailVerified + banner   an unverified account browses but cannot
 *                              create keys or subscribe; drop the banner
 *                              and that gate becomes invisible.
 */
export const dynamic = "force-dynamic";

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const isStaff = (await currentStaffRole()) !== null;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  await ensureSessionReady(user.id);

  const verified = await isEmailVerified(user.id);

  return (
    <TooltipProvider delay={400}>
      {/*
        A BOUNDED viewport, not a minimum one. The wrapper's default is
        `min-h-svh`, which lets the document grow — the transcript then has
        no scroll box of its own, the page scrolls instead, and the composer
        ends up below the fold the moment a reply is longer than the screen.
        `h-dvh` gives every `flex-1 min-h-0` below it a real height to divide.
      */}
      <SidebarProvider className="h-dvh min-h-0">
        <ShellIdentityProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
          >
            Skip to content
          </a>
          <ChatSidebar isStaff={isStaff} />
          <SidebarInset id="main-content" className="min-w-0 min-h-0">
            <ChatHeader />
          {/* Mounted once for the whole shell: the shortcut is global, and a
              per-page palette would stop working the moment focus moved into
              the transcript. */}
          <SearchPalette />
            {!verified ? (
              <div
                role="status"
                className="flex flex-col gap-3 border-b border-warning/30 bg-warning/10 px-4 py-3 bg-warning/10 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Confirm your email address
                    </p>
                    <p className="mt-0.5 text-sm text-foreground">
                      You can chat, but creating an API key or starting a
                      subscription needs a confirmed address.
                    </p>
                  </div>
                </div>
                <div className="shrink-0 sm:w-64">
                  <ResendVerification />
                </div>
              </div>
            ) : null}
            {children}
          </SidebarInset>
        </ShellIdentityProvider>
      </SidebarProvider>
      {/* Lifted clear of the home indicator: sonner positions against the
          viewport bottom, which on a notched phone is under the gesture bar. */}
      <Toaster position="bottom-right" mobileOffset={{ bottom: 24, right: 16 }} />
    </TooltipProvider>
  );
}
