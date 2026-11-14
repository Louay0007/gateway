"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Moon, Plus, Sun, Ghost, MoreHorizontal } from "lucide-react";

import Logo from "@/assets/logo/logo";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/auth/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { SidebarConversations, useShortcutLabel } from "@/components/chat/conversation-search";
import { ProjectList } from "@/components/chat/project-list";
import { useProjects } from "@/components/chat/use-projects";
import { chatNav } from "@/components/chat/nav";
import { useShellIdentity } from "@/components/dashboard/shell-identity";
import { Button } from "@/components/ui/button";

/**
 * ChatSidebar — conversation list first, destinations second.
 *
 * The ChatGPT shape: "New chat" sits under the brand, the list fills the
 * scroll area, and destinations are a quiet footer. What was removed and
 * why:
 *
 *   BORDERS ON ROWS. A bordered, shadowed "New chat" button competed with
 *   the brand and read as the page's primary action, which belongs to the
 *   composer. It is a plain row now, marked by a `+`.
 *
 *   THE RAIL'S EDGE. Separation comes from `--chat-rail` being a hair
 *   darker than the canvas, not from a vertical rule. A border there draws
 *   a box around a column that is already a different tone.
 *
 * Identity comes from ShellIdentityProvider (the same context the dashboard
 * shell uses) so this adds no request: /api/orgs and /api/profile are
 * already fetched once per shell mount.
 */
export function ChatSidebar({ isStaff = false }: { isStaff?: boolean } = {}) {
  const { state } = useSidebar();
  const pathname = usePathname();
  const collapsed = state === "collapsed";
  const { projects, loading: projectsLoading, reload: reloadProjects } = useProjects();
  const shortcut = useShortcutLabel();
  const [selectedProject, setSelectedProject] = React.useState<string | null>(null);

  return (
    <Sidebar collapsible="icon" className="[&_[data-sidebar=sidebar]]:bg-chat-rail">
      <SidebarHeader className="h-14 flex-row items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        <Link
          href="/chat"
          aria-label="Zaino AI chat"
          className="flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Logo wordmark={!collapsed} size={collapsed ? "sm" : "md"} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 pt-1 pb-0 group-data-[collapsible=icon]:px-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                {/* Never marked active. On /chat it would sit permanently
                    tinted, which reads as a selected row rather than an
                    action — and the empty transcript below already says
                    where you are. */}
                <Row href="/chat" tooltip="New chat" icon={Plus}>
                  New chat
                </Row>
              </SidebarMenuItem>
              <SidebarMenuItem>
                {/* A temporary chat is a new chat with one flag, so it needs
                    its own entry rather than a toggle inside a chat you have
                    already started talking in. */}
                <Row
                  href="/chat?temporary=1"
                  tooltip="Temporary chat — not saved, not remembered"
                  icon={Ghost}
                  muted
                >
                  Temporary chat
                </Row>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Projects sit above the chats they group. The selection lives HERE
            because two children need it: ProjectList highlights the row and
            ConversationList filters to it. */}
        <ProjectList
          projects={projects}
          loading={projectsLoading}
          reload={reloadProjects}
          selectedId={selectedProject}
          onSelect={setSelectedProject}
        />

        {/* The filter replaces the list rather than sitting above it. */}
        <SidebarConversations
          list={
            <ConversationList
              projectId={selectedProject}
              projects={projects}
              onMoved={reloadProjects}
            />
          }
          onSearchShortcut={shortcut}
        />
      </SidebarContent>

      {/* One row. Settings, keys, download and operations used to be four
          full-width rows stacked here, which made the foot of the rail the
          heaviest thing on the screen for destinations a person visits once
          a week. They are the account menu's items now — the same place
          ChatGPT puts them — and the rail ends on identity. */}
      <SidebarFooter className="border-t border-(--chat-hairline) p-2">
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
            <UserMenu collapsed={collapsed} isStaff={isStaff} />
          </div>
          <ThemeToggle collapsed={collapsed} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/** One rail row: no border, no shadow, 13px, active = tint. */
function Row({
  href,
  active = false,
  muted = false,
  tooltip,
  icon: Icon,
  children,
}: {
  href: string;
  active?: boolean;
  muted?: boolean;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
  children: string;
}) {
  return (
    <Link
      href={href}
      title={tooltip}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-[13px]",
        "transition-colors duration-100",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : muted
            ? "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate group-data-[collapsible=icon]:hidden">{children}</span>
    </Link>
  );
}

/**
 * One icon button. The theme toggle used to be a full labelled row directly
 * above the account row — two full-width controls stacked at the foot of the
 * rail, which is the heaviest thing a footer can do. It is a small circular
 * button beside the account now.
 */
function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Light mode" : "Dark mode"}
      // The accessible name must contain the visible label, or a screen
      // reader hears a name sharing no word with what is on screen (the
      // label-content-name mismatch axe flags).
      aria-label={dark ? "Dark theme — switch to light mode" : "Light theme — switch to dark mode"}
      className="shrink-0 rounded-full text-muted-foreground"
    >
      {mounted && dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      {collapsed ? null : <span className="sr-only">Theme</span>}
    </Button>
  );
}

function UserMenu({ collapsed, isStaff }: { collapsed: boolean; isStaff: boolean }) {
  const { isMobile } = useSidebar();
  const { org, role, user } = useShellIdentity();

  // Settings, keys, download and operations live in this menu rather than as
  // rows in the rail — see the footer's note. The active tab still has to be
  // known here, so `usePathname` is read once for the whole block.
  const pathname = usePathname();
  const destinations = React.useMemo(
    () => chatNav.filter((i) => !i.staffOnly || isStaff),
    [isStaff],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none",
              "transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              "aria-expanded:bg-sidebar-accent",
              "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
            )}
            aria-label="Account menu"
          >
            <Avatar className="size-6 shrink-0">
              {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback className="text-[11px] font-medium">
                {user ? user.initials : "…"}
              </AvatarFallback>
            </Avatar>
            {!collapsed || isMobile ? (
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-[13px] font-medium">
                  {(user?.name || org?.name) ?? "Account"}
                </span>
              </span>
            ) : null}
            {!collapsed || isMobile ? (
              <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
          </button>
        }
      />
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="truncate text-[13px] font-medium">
              {user?.name || org?.name || "Account"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {user?.email ?? (role ? `Role: ${role}` : "")}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/dashboard/billing" />}>Plan and usage</DropdownMenuItem>
        {destinations.map((item) => (
          <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
            <item.icon />
            {item.title}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start gap-2 px-1.5 py-1 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
