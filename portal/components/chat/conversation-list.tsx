"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Check,
  X,
  FolderInput,
} from "lucide-react";

import { useApi, apiSend } from "@/lib/api/use-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { ProjectRow } from "@/components/chat/use-projects";

export interface ConversationListItem {
  id: string;
  title: string;
  lastMessageAt: string | null;
  pinnedAt: string | null;
  projectId: string | null;
}

/**
 * ConversationList — the sidebar's scroll area.
 *
 * TWO BEHAVIOURS THAT ARE DELIBERATE:
 *
 *   FILTERED BY PROJECT. `projectId` narrows the list to one folder; null
 *   shows everything. The filter is a prop rather than local state because
 *   ProjectList owns the selection.
 *
 *   DELETE ASKS FIRST. It was a single click on a hover-revealed trash icon
 *   with no confirmation — while archiving a *project* (which deletes
 *   nothing) asked with `window.confirm`. The destructive action was the
 *   unguarded one.
 */
export function ConversationList({
  projectId = null,
  projects = [],
  onMoved,
}: {
  projectId?: string | null;
  projects?: ProjectRow[];
  onMoved?: () => void;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, loading, reload } = useApi<{ conversations: ConversationListItem[] }>(
    "/api/chat/conversations",
  );

  const conversations = React.useMemo(() => {
    const all = data?.conversations ?? [];
    if (!projectId) return all;
    return all.filter((c) => c.projectId === projectId);
  }, [data, projectId]);

  // A new conversation is created by the first send on /chat, in a sibling
  // component. The list lives in the layout and is not re-rendered either,
  // so it is told by event rather than by polling.
  React.useEffect(() => {
    const onCreated = () => reload();
    window.addEventListener("chat:conversation-created", onCreated);
    return () => window.removeEventListener("chat:conversation-created", onCreated);
  }, [reload]);

  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const remove = React.useCallback(
    async (id: string, title: string) => {
      if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;
      const res = await apiSend(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if ("error" in res) return;
      reload();
      if (pathname === `/chat/${id}`) router.push("/chat");
    },
    [pathname, reload, router],
  );

  const patch = React.useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await apiSend(`/api/chat/conversations/${id}`, { method: "PATCH", body });
      if ("error" in res) return false;
      reload();
      return true;
    },
    [reload],
  );

  const move = React.useCallback(
    async (id: string, nextProjectId: string | null) => {
      const res = await apiSend(`/api/chat/conversations/${id}/project`, {
        method: "PUT",
        body: { projectId: nextProjectId },
      });
      if ("error" in res) return;
      reload();
      onMoved?.();
    },
    [reload, onMoved],
  );

  const saveTitle = React.useCallback(
    async (id: string) => {
      const title = draft.trim();
      if (!title) return setEditing(null);
      const ok = await patch(id, { title });
      if (ok) setEditing(null);
    },
    [draft, patch],
  );

  return (
    <SidebarGroup className="min-h-0 flex-1">
      <SidebarGroupLabel className="px-3 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
        {projectId ? (projects.find((p) => p.id === projectId)?.name ?? "Project") : "Recent"}
      </SidebarGroupLabel>
      <SidebarGroupContent className="chat-scroll overflow-y-auto px-1.5">
        {loading ? (
          <div className="grid gap-1 px-0.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-7 animate-pulse rounded-md bg-sidebar-accent/40"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
            {projectId
              ? "No chats in this project yet. Move one here from its ⋯ menu."
              : "Nothing here yet. Your conversations appear as you start them."}
          </p>
        ) : (
          <SidebarMenu>
            {conversations.map((c) => {
              const pinned = Boolean(c.pinnedAt);
              if (editing === c.id) {
                return (
                  <SidebarMenuItem key={c.id}>
                    <form
                      className="flex items-center gap-1 px-1 py-0.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveTitle(c.id);
                      }}
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                        }}
                        maxLength={120}
                        aria-label="Conversation title"
                        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      />
                      <button
                        type="submit"
                        aria-label="Save title"
                        className="rounded p-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        aria-label="Cancel rename"
                        className="rounded p-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <X className="size-3.5" />
                      </button>
                    </form>
                  </SidebarMenuItem>
                );
              }

              return (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    render={<Link href={`/chat/${c.id}`} />}
                    isActive={pathname === `/chat/${c.id}`}
                    tooltip={c.title}
                  >
                    {pinned ? <Pin className="text-muted-foreground" /> : <MessageSquare />}
                    <span className="truncate">{c.title}</span>
                  </SidebarMenuButton>

                  <SidebarMenuAction
                    onClick={() => void patch(c.id, { pinned: !pinned })}
                    aria-label={pinned ? `Unpin ${c.title}` : `Pin ${c.title}`}
                    showOnHover
                    className="right-[5.75rem]"
                  >
                    {pinned ? <PinOff /> : <Pin />}
                  </SidebarMenuAction>

                  <SidebarMenuAction
                    onClick={() => {
                      setEditing(c.id);
                      setDraft(c.title);
                    }}
                    aria-label={`Rename ${c.title}`}
                    showOnHover
                    className="right-[3.85rem]"
                  >
                    <Pencil />
                  </SidebarMenuAction>

                  {/* Move to project. This route existed with no caller, so
                      a chat could never actually be filed. */}
                  {projects.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="absolute top-1.5 right-[1.95rem] flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground opacity-0 ring-sidebar-ring outline-hidden transition-opacity group-hover/menu-item:opacity-100 hover:bg-sidebar-accent focus-visible:ring-2 data-open:opacity-100 md:opacity-0"
                        aria-label={`Move ${c.title} to a project`}
                      >
                        <FolderInput className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="right" className="w-48">
                        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                          Move to project
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {projects.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            disabled={p.id === c.projectId}
                            onClick={() => void move(c.id, p.id)}
                          >
                            {p.id === c.projectId ? (
                              <Check className="mr-2 size-3.5" />
                            ) : (
                              <MessageSquare className="mr-2 size-3.5" />
                            )}
                            <span className="truncate">{p.name}</span>
                          </DropdownMenuItem>
                        ))}
                        {c.projectId ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void move(c.id, null)}>
                              Remove from project
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}

                  <SidebarMenuAction
                    onClick={() => void remove(c.id, c.title)}
                    aria-label={`Delete conversation ${c.title}`}
                    showOnHover
                    className="right-1"
                  >
                    <Trash2 />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
