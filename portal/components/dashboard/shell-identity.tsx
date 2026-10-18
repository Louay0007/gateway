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
  /**
   * Re-read everything the shell knows about the caller.
   *
   * This exists because of a real bug: the settings page keeps its OWN
   * `useApi("/api/profile")` instance, so after PATCHing a new picture it
   * updated its own state and showed the image — while the sidebar and
   * header, which read THIS context, kept the snapshot they fetched at
   * mount. `router.refresh()` does not help: it re-renders Server
   * Components, it does not re-run a client `useEffect` fetch. The account
   * page and the nav disagreed until a hard reload.
   *
   * A write to the profile anywhere in the tree must call this, or the
   * shell stays stale.
   */
  refresh: () => void;
}

const ShellContext = React.createContext<ShellValue>({
  org: null,
  role: null,
  user: null,
  bundle: null,
  loading: true,
  refresh: () => {},
});

export function ShellIdentityProvider({ children }: { children: React.ReactNode }) {
  const orgs = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const profile = useApi<ProfileView>("/api/profile");
  const bundle = useApi<SubscriptionBundle>("/api/subscription");

  // Stable identity: the provider re-renders on every state change, and a
  // fresh function each render would make `refresh` a new prop for every
  // consumer on every fetch.
  const refresh = React.useCallback(() => {
    orgs.reload();
    profile.reload();
    bundle.reload();
  }, [orgs.reload, profile.reload, bundle.reload]);

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
      refresh,
    };
  }, [orgs.data, orgs.loading, profile.data, profile.loading, bundle.data, bundle.loading, refresh]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellIdentity(): ShellValue {
  return React.useContext(ShellContext);
}