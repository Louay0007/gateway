import { redirect } from "next/navigation";

/**
 * /settings — a permanent redirect, kept because the URL has been in the
 * chat shell's navigation since it shipped.
 *
 * WHY NOT DELETE IT. Two URL trees rendered the same `SettingsPanel`: one in
 * the chat shell, one in the console shell. The chat one existed only
 * because the chat sidebar needed a settings destination, and the panel's
 * `shell` prop changed exactly one footer link. That is a duplicate surface
 * with a duplicate back-button history, a duplicate SEO entry, and two
 * places for a future `?tab=` to be forgotten.
 *
 * The canonical page is /dashboard/settings. This route preserves every
 * existing bookmark and any link a customer already has, including the
 * `?tab=` query — losing that would silently land people on the wrong tab.
 *
 * Rendered at request time because the query string must be forwarded.
 */
export const dynamic = "force-dynamic";

export default async function LegacySettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
  }
  const query = qs.toString();
  redirect(`/dashboard/settings${query ? `?${query}` : ""}`);
}
