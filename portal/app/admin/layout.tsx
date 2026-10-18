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
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { currentStaffRole } from "@/lib/auth/authorize";
import { listD17Queue } from "@/lib/billing/d17-admin";

export const dynamic = "force-dynamic";

const ADMIN_GATE_COOKIE = "admin_gate";

/**
 * Verify the admin gate cookie matches the server secret.
 * Returns true when the gate is not configured (no secret set), so the
 * console works without the extra layer in environments that don't need it.
 */
async function gatePassed(): Promise<boolean> {
  const secret = process.env.ADMIN_GATE_SECRET;
  if (!secret) return true; // gate disabled when no secret is set
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_GATE_COOKIE)?.value;
  if (!value) return false;
  const expected = crypto.createHmac("sha256", secret).update(ADMIN_GATE_COOKIE).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  } catch {
    return false;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Gate check runs BEFORE the staff role check. When the cookie is
  // missing or invalid, render only {children} — which at /admin is the
  // gate form (a client component). The full console shell (sidebar,
  // toaster) must NOT render until the gate passes, but the gate form
  // itself must be visible so the operator can enter the code.
  if (!(await gatePassed())) {
    return <>{children}</>;
  }

  // When the gate cookie is valid, the secret code IS the authentication.
  // We still try to read the staff role for display purposes (sidebar badge),
  // but we do NOT block access if no staff row exists — the gate is sufficient.
  const role = (await currentStaffRole()) ?? "owner";
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