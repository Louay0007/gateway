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
import { redirect } from "next/navigation";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cookies, headers } from "next/headers";
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

/**
 * Does the request address the gate page itself (`/admin`)?
 *
 * This layout cannot see the pathname, so it asks the proxy: `proxy.ts`
 * sets `x-admin-gate-path: 1` on requests whose pathname is exactly
 * `/admin`. Without it the layout had to guess, and the guess was
 * `redirect("/admin")` for EVERY ungated request — including a request to
 * `/admin` itself, which is an infinite redirect loop. That made the
 * console unreachable from the portal host for everyone: a staff member
 * following the nav got ERR_TOO_MANY_REDIRECTS instead of the gate form.
 */
async function isGatePage(): Promise<boolean> {
  const h = await headers();
  return h.get("x-admin-gate-path") === "1";
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Gate check runs BEFORE the staff role check.
  //
  // REDIRECT, not `return <>{children}</>`.
  //
  // The previous version rendered the children with the shell suppressed,
  // on the reasoning that "at /admin, children IS the gate form". That is
  // true for exactly one route. For /admin/ops, /admin/orgs, /admin/d17,
  // /admin/audit, /admin/plans, /admin/staff, /admin/credits and
  // /admin/usage the children are the ACTUAL CONSOLE, so the gate was
  // suppressing chrome while still serving the page — /admin/ops returned
  // 200 with "Job health" and the job table to a caller holding no cookie
  // at all.
  //
  // It was not exploitable only because the IP allowlist in config/Caddyfile
  // meant almost nobody could reach it. That allowlist has been removed: the
  // console is public and this secret is the only pre-auth layer, so
  // rendering children ungated would be a live exposure.
  //
  // /admin is the one route that stays reachable while ungated — it
  // renders its own gate form (app/admin/page.tsx) and redirects onward
  // once the cookie is valid. Everything else redirects TO it, never to
  // itself.
  if (!(await gatePassed())) {
    if (!(await isGatePage())) redirect("/admin");
  }

  // STAFF ROLE IS THE AUTHORIZATION; THE GATE IS ONLY A PRE-AUTH STEP.
  //
  // This used to read `(await currentStaffRole()) ?? "owner"`, on the
  // reasoning that "the gate secret is sufficient". It is not: a shared
  // code is one credential for the whole company, and defaulting a
  // missing role to `owner` meant anyone who knew it rendered every
  // console page — customers' orgs, usage, audit trail, the staff roster
  // — with the highest rank's buttons drawn. Every mutating API still
  // refused them (`requireStaff`), so the exposure was read-only, but it
  // was the entire customer database behind a single string.
  //
  // A caller with no staff row therefore gets NOTHING from this layout
  // except the gate page itself, which is where they are told to sign in
  // to a staff account. The shared code alone opens no data.
  const role = await currentStaffRole();
  const gatePage = await isGatePage();
  if (!role) {
    if (!gatePage) redirect("/admin");
    // Gate page with no session: render it WITHOUT the console shell.
    // Mounting a sidebar here would mean drawing the whole navigation for
    // someone who has proved nothing but the shared code, and every link
    // in it now redirects. The gate page supplies its own full-screen
    // styling and its own <Toaster/> is not needed.
    return <>{children}</>;
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