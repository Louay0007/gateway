/**
 * Admin route-group layout — the operations console shell.
 *
 * ONE CHECK, ONE ANSWER. This layout used to be a three-layer puzzle: an
 * HMAC gate cookie, an `x-admin-gate-path` header stamped by `proxy.ts` so
 * the layout could tell the gate form apart from a console page, and a staff
 * role lookup with a `?? "owner"` fallback that turned a shared code into the
 * highest rank. All three are gone with the console login (0053):
 *
 *   - there is no shared secret, so there is nothing to gate before the
 *     session check;
 *   - `/admin/login` renders OUTSIDE this layout, so no page here needs to
 *     be treated differently from any other;
 *   - the role comes from `currentStaffSession()`, which re-reads
 *     `staff_users` on every request, so a revoked operator loses the console
 *     on their next navigation with no session to wait out.
 *
 * `force-dynamic` is load-bearing. The shell reads the session to decide what
 * to render; without it `next build` evaluates this layout at build time,
 * where there is no request, no cookie and no AUTH_SECRET.
 *
 * THE TOASTER STAYS MOUNTED HERE, and that is not cosmetic. `/admin/*` sits
 * outside the `(app)` group where the Toaster is otherwise mounted, so every
 * `toast.*` call in `admin-orgs.tsx` or `d17-admin-queue.tsx` used to be
 * emitted into a context that renders nothing — an operator clicked Suspend,
 * the row updated, and no message ever appeared.
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

  // Every console page redirects to the SAME place, and `/admin/login` is not
  // under this layout — so unlike the old gate arrangement there is no
  // possible redirect loop to reason about here.
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
