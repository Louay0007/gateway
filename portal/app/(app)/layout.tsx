import type { ReactNode } from "react";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { ShellIdentityProvider } from "@/components/dashboard/shell-identity";
import { SiteHeader } from "@/components/dashboard/site-header";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { currentStaffRole } from "@/lib/auth/authorize";

/**
 * The shell reads the session (to decide which nav entries to offer), so
 * it must never be statically prerendered. Without this, `next build`
 * evaluates the layout at build time — where there is no request, no
 * cookie, and no AUTH_SECRET — and the product build fails on a layout
 * that only ever needed a request.
 */
export const dynamic = "force-dynamic";

/**
 * (app) — the signed-in product shell.
 *
 * Route group, so every page under it shares the sidebar + sticky header
 * exactly once without a layout file in the URL. Two details are
 * load-bearing:
 *
 *   min-w-0 on the inset — a flex item's min-width is `auto`, so the
 *   inset refuses to shrink below the min-content width of the widest
 *   thing inside it. At tablet widths (where the sidebar is permanent)
 *   that pushed the inset ~23px past the viewport and ate every card's
 *   right padding. `min-w-0` lets it shrink instead.
 *
 *   TooltipProvider wraps SidebarProvider — the sidebar's collapsed rail
 *   renders its labels through tooltips, which throw without a provider.
 *
 * UI-only stage: the shell renders the mock session. The real build
 * gates this layout on requireActiveOrg() and feeds the same components
 * from /api/subscription.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Resolved on the server so the sidebar can hide staff-only destinations.
  // `/admin/d17` is gated by its own page and routes; this decides only
  // whether the link is offered at all.
  const isStaff = (await currentStaffRole()) !== null;

  return (
    <TooltipProvider delay={400}>
      <SidebarProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
        >
          Skip to content
        </a>
        <AppSidebar isStaff={isStaff} />
        <SidebarInset id="main-content" className="min-w-0">
          <SiteHeader />
          <ShellIdentityProvider>
            <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</div>
          </ShellIdentityProvider>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
