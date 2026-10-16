"use client";

import * as React from "react";

import { useApi } from "@/lib/api/use-api";
import type { OrgListItem, ProfileView, SubscriptionBundle } from "@/lib/api/types";
import { initialsFor } from "@/lib/dashboard/format";

/**
 * ShellIdentity — who is signed in, fetched ONCE for the whole shell.
 *
 * The header and the sidebar both render the account identity, and both
 * used to read `mockUser` / `mockOrg` — an invented name, email and org
 * ("Yassine Ben Ali", "zaino@…") shown to every real customer as though it
 * were theirs.
 *
 * Identity comes from TWO endpoints on purpose. `GET /api/orgs` is
 * org-scoped and serves the org name and the caller's ROLE — the part the
 * shell needs for navigation. `GET /api/profile` is SELF-scoped (the id
 * comes from the session, never from a parameter) and serves the PERSON:
 * name, email, picture. There is no "current user" field on any org
 * route because a profile read is exactly the kind of thing that tempts a
 * route into trusting a body-supplied id.
 *
 * A context rather than three `useApi` calls so the shell makes one
 * request per endpoint, not one per consumer.
 */
interface ShellValue {
  org: OrgListItem | null;
  role: string | null;
  /** The signed-in person. Null until /api/profile answers. */
  user: {
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    /** Up to two letters, from the PERSON's name — not the org's. */
    initials: string;
  } | null;
  bundle: SubscriptionBundle | null;
  loading: boolean;
}

const ShellContext = React.createContext<ShellValue>({
  org: null,
  role: null,
  user: null,
  bundle: null,
  loading: true,
});

export function ShellIdentityProvider({ children }: { children: React.ReactNode }) {
  const orgs = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const profile = useApi<ProfileView>("/api/profile");
  const bundle = useApi<SubscriptionBundle>("/api/subscription");

  const value = React.useMemo<ShellValue>(() => {
    const org = orgs.data?.orgs?.[0] ?? null;
    const p = profile.data;
    return {
      org,
      role: org?.role ?? null,
      user: p
        ? {
            name: p.name,
            email: p.email,
            emailVerified: p.emailVerifiedAt !== null,
            image: p.image,
            initials: initialsFor(p.name, p.email),
          }
        : null,
      bundle: bundle.data,
      loading: orgs.loading || profile.loading || bundle.loading,
    };
  }, [orgs.data, orgs.loading, profile.data, profile.loading, bundle.data, bundle.loading]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellIdentity(): ShellValue {
  return React.useContext(ShellContext);
}