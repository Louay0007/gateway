import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminSignInForm } from "@/components/auth/admin-sign-in-form";
import { currentStaffSession } from "@/lib/auth/staff-session";

export const metadata: Metadata = { title: "Operations Console — Sign in" };

/**
 * `force-dynamic` is load-bearing. This page reads the console session to
 * decide whether to bounce; without it `next build` evaluates it at build
 * time, where there is no request, no cookie and no AUTH_SECRET.
 */
export const dynamic = "force-dynamic";

/**
 * /admin/login — the one console route reachable without a session.
 *
 * Deliberately OUTSIDE the console's visual shell. `app/admin/layout.tsx`
 * mounts the sidebar, the tooltip provider and the Toaster, and redirects
 * anyone without a session — mounting all of that for a caller who has
 * proved nothing would draw the whole navigation for someone whose every
 * click bounces back here.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  // Gated on the SESSION, not on `adminAuth()`: a cookie that parses but no
  // longer resolves (revoked row, stale password stamp) must land on the
  // form, because the console gate rejects the same cookie and the two would
  // otherwise bounce off each other forever.
  if (await currentStaffSession()) redirect("/admin/ops");

  const params = await searchParams;

  // Only a same-site path under /admin survives. The action re-validates;
  // this keeps the hidden field meaningful and the form honest.
  const raw = params.next ?? "/admin/ops";
  const next = raw.startsWith("/admin") && !raw.startsWith("//") ? raw : "/admin/ops";

  return <AdminSignInForm next={next} signedOut={params.signedOut === "1"} />;
}
