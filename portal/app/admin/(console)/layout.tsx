/**
 * Admin console layout — the shell for the OPERATIONS CONSOLE only.
 *
 * ⚠️ THIS LIVES IN A ROUTE GROUP `(console)`, AND THAT IS LOAD-BEARING.
 *
 * A `layout.tsx` applies to every descendant route. It used to sit at
 * `app/admin/layout.tsx`, which made it wrap `app/admin/login/page.tsx` too —
 * so an unauthenticated request to the login page entered this layout, found
 * no session, and redirected to `/admin/login`: the page it was already
 * rendering. That is an infinite redirect loop, and it locked every operator
 * out of the console unconditionally. `ERR_TOO_MANY_REDIRECTS`, no error
 * anywhere, the exact failure the old shared-code gate had been written to
 * avoid.
 *
 * The route group changes WHERE the layout applies without changing a single
 * URL: `(console)` is stripped from the path, so `app/admin/(console)/ops`
 * still serves `/admin/ops`. `/admin/login` sits outside it and renders with
 * no shell — which is also what it wants visually, since it draws its own
 * full-screen card.
 *
 * NEVER move this file back up to `app/admin/layout.tsx`. A test asserts the
 * nesting (`tests/admin-login.test.ts`) because nothing about the page itself
 * can reveal the loop.
 *
 * ONE CHECK, ONE ANSWER. The role comes from `currentStaffSession()`, which
 * re-reads `staff_users` on every request, so a revoked operator loses the
 * console on their next navigation with no session to wait out. There is no
 * shared access code any more (0053): it named nobody, could not be revoked
 * per operator, and was written into `audit_log` as the opaque
 * `gate-operator`.
 *
 * `force-dynamic` is load-bearing. The shell reads the session to decide what
 * to render; without it `next build` evaluates this layout at build time,
 * where there is no request, no cookie and no AUTH_SECRET.
 *
 * THE TOASTER STAYS MOUNTED HERE, and that is not cosmetic. These pages sit
 * outside the `(app)` group where the Toaster is otherwise mounted, so every
 * `toast.*` call in `admin-orgs.tsx` or `d17-admin-queue.tsx` was emitted into
 * a context that renders nothing — an operator clicked Suspend, the row
 * updated, and no message ever appeared.
 */

import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { currentStaffSession } from "@/lib/auth/staff-session";
import { listD17Queue } from "@/lib/billing/d17-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaffSession();

  // Safe to redirect to /admin/login: it is OUTSIDE this layout, so the
  // target renders instead of re-entering this guard.
  if (!staff) redirect("/admin/login");

  // A failure here must not take the whole console down — an operator can
  // still work, they just do not get a badge. The queue query is a
  // convenience, not a gate.
  //
  // Only `proof_submitted` is counted. `listD17Queue` also returns
  // paid/rejected/expired rows so an operator can see what they just did, and
  // a badge counting those would never reach zero.
  let waitingCount = 0;
  try {
    waitingCount = (await listD17Queue(["proof_submitted"])).length;
  } catch {
    waitingCount = 0;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar role={staff.role} username={staff.username} waitingCount={waitingCount} />
        <SidebarInset className="min-w-0">{children}</SidebarInset>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </TooltipProvider>
  );
}
