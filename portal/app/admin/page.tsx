import { redirect } from "next/navigation";

import { currentStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

/**
 * `/admin` — an entry point, not a page.
 *
 * It used to render the shared-access-code form, and in production Caddy
 * served a static `admin-gate.html` copy of that same form instead —
 * bypassing Next.js entirely, because the root layout's theme CSS rendered it
 * white-on-white. Two implementations of one screen, and both are gone with
 * the console login (0053).
 *
 * Now there is nothing to render: resolve the session and send the operator
 * to where the work actually is. `/admin/ops` is the landing page because it
 * answers the question every other console screen depends on — "can I trust
 * these numbers?".
 */
export default async function AdminEntryPage() {
  const staff = await currentStaffSession();
  redirect(staff ? "/admin/ops" : "/admin/login");
}
