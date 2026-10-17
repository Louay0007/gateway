"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LogOut,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/auth/actions";
import Logo from "@/assets/logo/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { navMain, navSecondary } from "@/components/dashboard/nav";
import { useShellIdentity } from "@/components/dashboard/shell-identity";

/**
 * AppSidebar — the product shell's navigation.
 *
 * The desktop nav is the whole information architecture of the signed-in
 * app (Overview / Usage / API keys / Billing, then Settings and the
 * staff-only D17 queue); below `md` the shadcn sidebar component turns
 * the same tree into a Sheet, so there is one nav list to maintain.
 * `tooltip` on each button is what makes the collapsed rail usable:
 * labels appear on hover when the icons-only strip is showing.
 *
 * `isStaff` comes from the layout, which resolved it from `staff_users`
 * on the server. `staffOnly` entries are FILTERED OUT rather than
 * disabled: a customer has no reason to see "D17 queue" at all, and a
 * disabled link to a 403 is noise. The routes stay the authority — this
 * only decides what is offered.
 */
export function AppSidebar({ isStaff = false }: { isStaff?: boolean } = {}) {
  const { state } = useSidebar();
  const { org } = useShellIdentity();
  const pathname = usePathname();
  const collapsed = state === "collapsed";
  const active = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <Link
          href="/dashboard"
          aria-label="Zaino AI dashboard"
          className={cn(
            "flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
            collapsed && "justify-center",
          )}
        >
          {/* Collapsed the rail is 3rem wide: the wordmark would clip, so
              the mark carries the brand alone. */}
          <Logo wordmark={!collapsed} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navMain.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={active(item.href)}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary
                .filter((item) => !item.staffOnly || isStaff)
                .map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={active(item.href)}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.staffOnly ? (
                    <Badge
                      variant="outline"
                      className="pointer-events-none absolute top-1.5 right-1.5 group-data-[collapsible=icon]:hidden"
                    >
                      Staff
                    </Badge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <ThemeToggle collapsed={collapsed} />
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu collapsed={collapsed} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={dark ? "Light mode" : "Dark mode"}
          onClick={() => setTheme(dark ? "light" : "dark")}
          // The accessible name MUST contain the visible label ("Light" /
          // "Dark") or axe flags a label-content-name mismatch: a screen
          // reader user hears a name that shares no word with what is on
          // screen. Keep the visible word and append the action.
          aria-label={dark ? "Dark theme — switch to light mode" : "Light theme — switch to dark mode"}
        >
          {mounted && dark ? <Moon /> : <Sun />}
          <span>{dark ? "Dark" : "Light"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { isMobile } = useSidebar();
  const { org, role, user } = useShellIdentity();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 aria-expanded:bg-sidebar-accent"
            aria-label="Account menu"
          >
          <Avatar className="size-8">
            {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="text-xs font-medium">
              {user?.initials ?? "?"}
            </AvatarFallback>
          </Avatar>
          {!collapsed || isMobile ? (
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate font-medium">{(user?.name || org?.name) ?? "Account"}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user?.email ?? org?.name ?? ""}
              </span>
            </span>
          ) : null}
        </button>
        }
      />
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="text-sm font-medium">{org?.name ?? "Account"}</span>
            <span className="text-xs text-muted-foreground">{role ? `Role: ${role}` : ""}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
          <UserRound />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10 focus-visible:ring-2"
          >
            <LogOut />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
