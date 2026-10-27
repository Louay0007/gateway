/**
 * AdminSidebar — navigation for the operations console.
 *
 * A SEPARATE component from the product's `AppSidebar`, not a variant of
 * it. The customer shell is built around `ShellIdentityProvider` and the
 * customer's own org; an operator has no org, and wiring a provider that
 * would always resolve to nothing just to reuse six list items would put
 * a null-check on every render. The information architecture is also
 * genuinely different — an operator asks "who is affected?", "did the
 * collector die?" and "what did we refund?", none of which appear in the
 * product nav at all.
 *
 * VISIBILITY IS FILTERED BY ROLE, NOT DISABLED. A `read_only` analyst
 * has no reason to see "Staff" links to pages that would answer 403, and
 * a disabled link is noise. The routes remain the authority; this only
 * decides what is offered.
 *
 * The role comes from the server layout (`currentStaffRole()`), which
 * re-reads `staff_users` on every request — so a revoked operator loses
 * the whole console on their next navigation, with no session to wait
 * out.
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  CreditCard,
  FileClock,
  LayoutDashboard,
  LogOut,
  Layers,
  Receipt,
  Users,
  type LucideIcon,
} from "lucide-react";

import { signOutAction } from "@/lib/auth/actions";
import { staffAtLeast, type StaffRole } from "@/lib/auth/staff-roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface AdminNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Minimum staff role that is OFFERED this link. Routes still gate. */
  minRole: StaffRole;
  /** Count badge, e.g. payments waiting for review. */
  badge?: number;
}

/**
 * Order is OPERATIONAL, not alphabetical: the two lists an operator works
 * from every day first, then the money views, then the settings-ish
 * surfaces. "Pipeline" is also the landing page, because `/admin` itself
 * is the gate form and redirects onward — so the first nav item is
 * wherever that redirect lands.
 *
 * THERE IS NO "OVERVIEW" ITEM. It pointed at `/admin`, which never
 * renders a page of its own: it shows the access-code form and 302s to
 * `/admin/ops`. A link that always bounces is worse than no link, and
 * the active-state logic below had to special-case it just to stop it
 * lighting up on every route.
 *
 * `minRole` is the role that is OFFERED the link. Every entry is
 * `read_only`, and that is correct rather than lazy: the corresponding
 * GETs really are open to any staff role, and the WRITE controls inside
 * Plans and Staff are what require `owner` (`canEdit` / `canManage` on
 * those pages). Hiding the whole page from a `support` operator would
 * take away read access they legitimately have; the filter exists so a
 * future read-restricted page can express that, not so these ones can
 * pretend to.
 */
const NAV: AdminNavItem[] = [
  { title: "Pipeline", href: "/admin/ops", icon: Activity, minRole: "read_only" },
  { title: "Accounts", href: "/admin/orgs", icon: Building2, minRole: "read_only" },
  { title: "D17 queue", href: "/admin/d17", icon: Receipt, minRole: "read_only" },
  { title: "Usage & margin", href: "/admin/usage", icon: LayoutDashboard, minRole: "read_only" },
  { title: "Credits", href: "/admin/credits", icon: CreditCard, minRole: "read_only" },
  { title: "Audit", href: "/admin/audit", icon: FileClock, minRole: "read_only" },
  { title: "Plans", href: "/admin/plans", icon: Layers, minRole: "read_only" },
  { title: "Staff", href: "/admin/staff", icon: Users, minRole: "read_only" },
];

export function AdminSidebar({
  role,
  email,
  waitingCount = 0,
}: {
  role: StaffRole;
  email: string | null;
  waitingCount?: number;
}) {
  const pathname = usePathname();

  // Prefix match, so the drill-down at `/admin/orgs/<id>` keeps Accounts
  // lit — it is still the Accounts section. The bare `/admin` prefix is
  // what made the old "Overview" entry light up on every route at once,
  // which is why the landing entry is `/admin/ops` and not `/admin`.
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const visible = NAV.filter((item) => staffAtLeast(role, item.minRole));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <Link
          href="/admin/ops"
          aria-label="Zaino operations console"
          className="flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <span className="px-2 text-sm font-semibold tracking-tight">Operations</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
                const count = item.href === "/admin/d17" ? waitingCount : 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item.href)}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                      {count > 0 ? (
                        <Badge variant="default" className="ml-auto tabular-nums">
                          {count}
                        </Badge>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex flex-col gap-2 px-2 py-2">
          {email ? (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{email}</p>
              <Badge variant="outline" className="mt-1">
                staff: {role}
              </Badge>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Customer view
          </Button>
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" type="submit" className="w-full">
              <LogOut />
              Sign out
            </Button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}