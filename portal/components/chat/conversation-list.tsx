"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import { useApi, apiSend } from "@/lib/api/use-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/components/chat/use-projects";
import { Button } from "@/components/ui/button";

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
 * GROUPED BY RECENCY, TITLED, NO ICONS. ChatGPT's rail is the reference: a
 * conversation row is its name, and nothing else. The per-row square glyph
 * this replaces was identical on every row, so it carried no information
 * while spending the one column the title needed — every title was cut
 * short by an icon that said "this is a chat" forty times. Pinned rows keep
 * a small pin because that state is real and per-row.
 *
 * ONE MENU, NOT FOUR BUTTONS. Pin, rename, move and delete used to be four
 * absolutely-positioned buttons at hardcoded `right-[5.75rem]`-style
 * offsets, which only lined up at one font size and put a delete target
 * 4px from a rename target. They are one `⋯` menu now.
 *
 * FILTERED BY PROJECT. `projectId` narrows the list to one folder; null
 * shows everything. The filter is a prop because ProjectList owns the
 * selection.
 *
 * DELETE ASKS FIRST — it is destructive and unundoable.
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

  const groups = React.useMemo(() => {
    const all = data?.conversations ?? [];
    const rows = projectId ? all.filter((c) => c.projectId === projectId) : all;
    const buckets: ConversationListItem[][] = [[], [], [], [], []];
    for (const c of rows) buckets[bucketOf(c.lastMessageAt)]!.push(c);
    return buckets;
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

  const empty = groups.every((g) => g.length === 0);

  return (
    <SidebarGroup className="min-h-0 flex-1 p-0 group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="grid gap-1 pt-1 px-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-7 animate-pulse rounded-md bg-sidebar-accent/50"
                style={{ animationDelay: `${i * 70}ms` }}
              />
            ))}
          </div>
        ) : empty ? (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground/70">
            {projectId
              ? "No chats in this project yet. Move one here from its ⋯ menu."
              : "Nothing here yet. Your conversations appear as you start them."}
          </p>
        ) : (
          groups.map((rows, bucket) =>
            rows.length === 0 ? null : (
              <section key={bucket} className="pt-3 first:pt-1">
                <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/70">
                  {BUCKET_LABELS[bucket]}
                </h3>
                <ul>
                  {rows.map((c) => {
                    if (editing === c.id) {
                      return (
                        <li key={c.id}>
                          <form
                            className="flex items-center gap-1 px-0.5 py-0.5"
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
                              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base outline-none focus-visible:border-ring sm:h-7 sm:text-[13px]"
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Save title"
                              className="size-auto p-1.5 text-muted-foreground sm:p-1"
                            >
                              <Check />
                            </Button>
                          </form>
                        </li>
                      );
                    }

                    const pinned = Boolean(c.pinnedAt);
                    const active = pathname === `/chat/${c.id}`;

                    return (
                      <li key={c.id} className="group/row relative">
                        <Link
                          href={`/chat/${c.id}`}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-8 items-center gap-1.5 rounded-md px-2 pr-8 text-[13px]",
                            "transition-colors duration-100",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {pinned ? (
                            <Pin
                              className="size-3 shrink-0 text-muted-foreground/60"
                              aria-label="Pinned"
                            />
                          ) : null}
                          <span className="truncate">{c.title}</span>
                        </Link>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={cn(
                              "absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md sm:size-6",
                              // Visible on touch, hover-revealed on a
                              // pointer. There is no hover on a phone, so
                              // `opacity-0` alone made Rename/Pin/Delete
                              // unreachable in the mobile sheet.
                              "text-muted-foreground transition-opacity md:opacity-0",
                              "group-hover/row:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100 focus-visible:outline-none",
                              "data-open:opacity-100 data-open:bg-sidebar-accent",
                            )}
                            aria-label={`Actions for ${c.title}`}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="right" className="w-52">
                            <DropdownMenuItem onClick={() => void patch(c.id, { pinned: !pinned })}>
                              {pinned ? <PinOff /> : <Pin />}
                              {pinned ? "Unpin" : "Pin to top"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(c.id);
                                setDraft(c.title);
                              }}
                            >
                              <Pencil />
                              Rename
                            </DropdownMenuItem>

                            {projects.length > 0 ? (
                              <>
                                <DropdownMenuSeparator />
                                {projects.map((p) => (
                                  <DropdownMenuItem
                                    key={p.id}
                                    disabled={p.id === c.projectId}
                                    onClick={() => void move(c.id, p.id)}
                                  >
                                    <FolderInput />
                                    <span className="truncate">{p.name}</span>
                                    {p.id === c.projectId ? (
                                      <Check className="ml-auto size-3.5" />
                                    ) : null}
                                  </DropdownMenuItem>
                                ))}
                                {c.projectId ? (
                                  <DropdownMenuItem onClick={() => void move(c.id, null)}>
                                    Remove from project
                                  </DropdownMenuItem>
                                ) : null}
                              </>
                            ) : null}

                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void remove(c.id, c.title)}
                            >
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
          )
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const BUCKET_LABELS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

/**
 * Which heading a conversation belongs under, by calendar day rather than
 * elapsed hours — 23:50 last night is "Yesterday", not "Today".
 *
 * `Date.UTC` on the local Y/M/D triple is the DST-safe way to subtract two
 * dates: dividing raw timestamps loses or gains an hour twice a year and
 * would file a chat under the wrong heading for one day.
 */
function bucketOf(iso: string | null): number {
  if (!iso) return 4;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 4;
  const day = (d: Date) =>
    Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const diff = day(new Date()) - day(then);
  if (diff <= 0) return 0;
  if (diff === 1) return 1;
  if (diff <= 7) return 2;
  if (diff <= 30) return 3;
  return 4;
}
