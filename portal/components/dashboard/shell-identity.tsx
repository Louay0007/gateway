"use client";

import * as React from "react";

import { useApi } from "@/lib/api/use-api";
import type { OrgListItem, SubscriptionBundle } from "@/lib/api/types";

/**
 * ShellIdentity — who is signed in, fetched ONCE for the whole shell.
 *
 * The header and the sidebar both render the account identity, and both
 * used to read `mockUser` / `mockOrg` — an invented name, email and org
 * ("Yassine Ben Ali", "zaino@…") shown to every real customer as though it
 * were theirs.
 *
 * There is no "current user" endpoint: identity is deliberately NOT part of
 * any org-scoped route, because a profile read is exactly the kind of thing
 * that tempts a route into trusting a body-supplied id. `GET /api/orgs`
 * already returns the org name and the caller's ROLE, which is the part the
 * shell actually needs — the personal name is not shown until an endpoint
 * exists to serve it truthfully.
 *
 * A context rather than two `useApi` calls so the shell makes one request,
 * not one per consumer.
 */
interface ShellValue {
  org: OrgListItem | null;
  role: string | null;
  /** Up to two letters for the avatar. Derived from the org name. */
  initials: string;
  bundle: SubscriptionBundle | null;
  loading: boolean;
}

const ShellContext = React.createContext<ShellValue>({
  org: null,
  role: null,
  initials: "",
  bundle: null,
  loading: true,
});

export function ShellIdentityProvider({ children }: { children: React.ReactNode }) {
  const orgs = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const bundle = useApi<SubscriptionBundle>("/api/subscription");

  const value = React.useMemo<ShellValue>(() => {
    const org = orgs.data?.orgs?.[0] ?? null;
    return {
      org,
      role: org?.role ?? null,
      initials: (org?.name ?? "?").slice(0, 2).toUpperCase(),
      bundle: bundle.data,
      loading: orgs.loading || bundle.loading,
    };
  }, [orgs.data, orgs.loading, bundle.data, bundle.loading]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellIdentity(): ShellValue {
  return React.useContext(ShellContext);
}