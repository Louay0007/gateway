import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { ShellIdentityProvider } from "@/components/dashboard/shell-identity";
import { SiteHeader } from "@/components/dashboard/site-header";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { currentStaffRole, currentUser } from "@/lib/auth/authorize";
import { ensureSessionReady } from "@/lib/auth/provision";
import { isEmailVerified } from "@/lib/auth/verify-email";
import { ResendVerification } from "@/components/auth/verify-email-forms";
import { MailWarning } from "lucide-react";

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
 * The shell resolves identity and staff role on the server and provisions
 * the caller's personal org before rendering, then hands the same
 * components to every product page. Client panels fetch their own data
 * from the /api routes.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Resolved on the server so the sidebar can hide staff-only destinations.
  // `/admin/d17` is gated by its own page and routes; this decides only
  // whether the link is offered at all.
  const isStaff = (await currentStaffRole()) !== null;

  // Unverified accounts keep read access but cannot create keys or start a
  // subscription (the routes enforce it). This banner is how they learn
  // that, and how they recover if the first mail was lost.
  const user = await currentUser();

  // Every page in this group is product surface. Without this gate an
  // anonymous request rendered the full shell anyway — sidebar, header,
  // account menu — and every client fetch answered 401, so /dashboard sat
  // on "Loading…" forever instead of sending the visitor to sign in.
  if (!user) redirect("/sign-in");

  // Provision the personal org on the first authenticated render, BEFORE
  // the client shell fires its parallel /api/orgs + /api/subscription
  // reads: those routes can only answer once a membership exists, and
  // doing it here keeps a cold first load from racing itself into two
  // orgs. Request-scoped via cache(), so a page that reads memberships
  // shares this one run rather than provisioning twice.
  await ensureSessionReady(user.id);

  const verified = await isEmailVerified(user.id);

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
            <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
              {!verified ? (
                <div
                  role="status"
                  className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <MailWarning className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-black">Confirm your email address</p>
                      <p className="mt-0.5 text-sm text-gray-700">
                        You can browse, but creating an API key or starting a
                        subscription needs a confirmed address — it is where we
                        send payment updates.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 sm:w-64">
                    <ResendVerification />
                  </div>
                </div>
              ) : null}
              {children}
            </div>
          </ShellIdentityProvider>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
