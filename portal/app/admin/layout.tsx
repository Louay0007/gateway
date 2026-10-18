/**
 * Admin route-group layout — the operations console shell.
 *
 * REPLACES the two-line layout that mounted only a `<Toaster/>`. That
 * was a real bug with a real symptom: `/admin` and `/admin/d17` sit
 * OUTSIDE the `(app)` group where the toaster is otherwise mounted, so
 * all 14 `toast.*` calls across `admin-orgs.tsx` and
 * `d17-admin-queue.tsx` were emitted into a context that renders
 * nothing — an operator clicked Suspend, the server cut the gateway, the
 * row updated, and no message ever appeared. The toaster stays, mounted
 * here for the whole `admin` group.
 *
 * THE GATE IS HERE, NOT ONLY IN EACH PAGE. `currentStaffRole()` re-reads
 * `staff_users` on every request and returns null for a revoked account,
 * so this is the single place that decides whether the console exists at
 * all. Individual pages still check (so an operator who arrives without
 * the role is told why rather than bounced), and every route still
 * enforces — this is the outermost of three, not the only one.
 *
 * `force-dynamic` is load-bearing. The shell reads the session to decide
 * what to render; without it `next build` evaluates this layout at build
 * time, where there is no request, no cookie and no AUTH_SECRET.
 *
 * Only `proof_submitted` is counted for the badge. `listD17Queue` also
 * returns paid/rejected/expired rows so an operator can see what they
 * just did, and a badge counting those would never reach zero.
 */

import type { ReactNode } from "react";
import Link from "next/link";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/auth";
import { currentStaffRole } from "@/lib/auth/authorize";
import { listD17Queue } from "@/lib/billing/d17-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const role = await currentStaffRole();

  if (!role) {
    // Render an explanation rather than redirecting. An operator who
    // lands here without the role needs to know the console exists and
    // is closed to them; a redirect to /dashboard looks like a bug.
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <h1 className="text-xl font-semibold tracking-tight">Staff access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The operations console is for the staff team. It is not part of
          a customer account, and this session is not a staff session.
        </p>
        <div className="mt-6">
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  const session = await auth();

  // A failure here must not take the whole console down — an operator
  // can still work, they just do not get a badge. The queue query is a
  // convenience, not a gate.
  let waitingCount = 0;
  try {
    waitingCount = (await listD17Queue(["proof_submitted"])).length;
  } catch {
    waitingCount = 0;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
          role={role}
          email={session?.user?.email ?? null}
          waitingCount={waitingCount}
        />
        <SidebarInset className="min-w-0">
          {children}
        </SidebarInset>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </TooltipProvider>
  );
}