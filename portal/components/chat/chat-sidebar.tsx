"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Moon, Plus, Sun, Ghost } from "lucide-react";

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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { SidebarConversations, shortcutLabel } from "@/components/chat/conversation-search";
import { ProjectList } from "@/components/chat/project-list";
import { useProjects } from "@/components/chat/use-projects";
import { chatNav } from "@/components/chat/nav";
import { useShellIdentity } from "@/components/dashboard/shell-identity";

/**
 * ChatSidebar — conversation list first, destinations second.
 *
 * The ChatGPT/Claude shape: the sidebar's job is to get you back into a
 * conversation, so "New chat" sits under the brand and the list fills the
 * scroll area. Settings and friends are a small group at the bottom.
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
  const [selectedProject, setSelectedProject] = React.useState<string | null>(null);

  return (
    <Sidebar collapsible="icon" className="[&_[data-sidebar=sidebar]]:bg-chat-rail">
      <SidebarHeader className="h-14 justify-center px-3">
        <Link
          href="/chat"
          aria-label="Zaino AI chat"
          className={cn(
            "flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
            collapsed && "justify-center",
          )}
        >
          <Logo wordmark={!collapsed} size={collapsed ? "sm" : "md"} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/chat" />}
                  isActive={pathname === "/chat"}
                  tooltip="New chat"
                  className="h-9 border border-sidebar-border bg-background font-medium shadow-[0_1px_2px_-1px_rgb(0_0_0/0.06)] transition-colors hover:bg-accent"
                >
                  <Plus />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                {/* A temporary chat is a new chat with one flag, so it needs
                    its own entry rather than a toggle inside a chat you have
                    already started talking in. */}
                <SidebarMenuButton
                  render={<Link href="/chat?temporary=1" />}
                  tooltip="Temporary chat — not saved, not remembered"
                  className="h-8 text-muted-foreground"
                >
                  <Ghost />
                  <span>Temporary chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Projects sit above the chats they group. The selection lives HERE
            because two children need it: ProjectList highlights the row and
            ConversationList filters to it. A single owner is also what stops
            the two from disagreeing about a project that was just archived. */}
        <ProjectList
          projects={projects}
          loading={projectsLoading}
          reload={reloadProjects}
          selectedId={selectedProject}
          onSelect={setSelectedProject}
        />

        {/* The filter replaces the list rather than sitting above it, and the
            shortcut hint teaches ⌘K without a tooltip the user has to find. */}
        <SidebarConversations
          list={
            <ConversationList
              projectId={selectedProject}
              projects={projects}
              onMoved={reloadProjects}
            />
          }
          onSearchShortcut={shortcutLabel()}
        />
      </SidebarContent>

      <SidebarFooter className="gap-0.5 p-2">
        <SidebarMenu>
          {chatNav
            .filter((item) => !item.staffOnly || isStaff)
            .map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={
                    item.href === "/settings"
                      ? pathname === "/settings"
                      : pathname === item.href
                  }
                  tooltip={item.title}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
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
          // The accessible name must contain the visible label, or a screen
          // reader hears a name sharing no word with what is on screen
          // (the label-content-name mismatch axe flags).
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
            <Avatar className="size-8 shrink-0">
              {user?.image ? (
                <AvatarImage src={user.image} alt="" />
              ) : null}
              <AvatarFallback className="text-xs font-medium">
                {user ? user.initials : "…"}
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
        <DropdownMenuItem render={<Link href="/settings?tab=plan" />}>Plan and usage</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>Account settings</DropdownMenuItem>
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
