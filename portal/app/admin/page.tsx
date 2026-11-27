import { redirect } from "next/navigation";

import { currentStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

/**
 * `/admin` — an entry point, not a page.
 *
 * It used to render the shared-access-code form, and in production Caddy
 * served a static `admin-gate.html` copy of that same form instead — bypassing
 * Next.js entirely, because the root layout's theme CSS rendered it
 * white-on-white. Two implementations of one screen, and both are gone with
 * the console login (0053).
 *
 * WHY THIS FILE IS NOT IN THE `(console)` GROUP. It sits at `app/admin/page.tsx`
 * so it renders with NO console shell and NO session check of its own — it
 * decides, then redirects. Putting it inside the group would make the layout
 * guard it too, which is harmless here but pointless: this route's whole job
 * is to answer "/admin" in one hop.
 */
export default async function AdminEntryPage() {
  const staff = await currentStaffSession();
  redirect(staff ? "/admin/ops" : "/admin/login");
}
