"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Folder, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiSend } from "@/lib/api/use-api";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/components/chat/use-projects";

/**
 * Projects — folders with their own instructions.
 *
 * A project is an OPTIONAL context layer, not a container you must choose,
 * so a user who never makes one sees nothing different.
 *
 * SELECTION IS REAL. The previous version accepted an `onSelect` prop that
 * the sidebar never passed, so every click called `onSelect?.(…)` on
 * `undefined` and nothing happened — the whole feature was unclickable. The
 * selection now lives in the sidebar and drives a conversation filter.
 *
 * Instructions are edited inline: they are two fields that apply to every
 * turn in the folder, and a route for two fields is a place people stop
 * going.
 */
export function ProjectList({
  projects,
  loading,
  reload,
  selectedId,
  onSelect,
}: {
  projects: ProjectRow[];
  loading: boolean;
  reload: () => void;
  /** The project currently filtering the conversation list, or null. */
  selectedId: string | null;
  onSelect: (projectId: string | null) => void;
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [instructions, setInstructions] = React.useState("");

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await apiSend<{ project: ProjectRow }>("/api/chat/projects", {
      method: "POST",
      body: { name: trimmed },
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    setName("");
    setCreating(false);
    reload();
  }

  async function archive(project: ProjectRow) {
    // The chats are NOT deleted; the archive unparents them, so they
    // reappear at the top level. Saying so is what makes this safe to press.
    if (
      !window.confirm(
        `Archive “${project.name}”? Its ${project.conversationCount} chat(s) move back to the main list — nothing is deleted.`,
      )
    ) {
      return;
    }
    const res = await apiSend(`/api/chat/projects/${project.id}`, { method: "DELETE" });
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    if (selectedId === project.id) onSelect(null);
    reload();
  }

  async function saveInstructions(id: string) {
    const res = await apiSend(`/api/chat/projects/${id}`, {
      method: "PATCH",
      body: { instructions },
    });
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    setEditing(null);
    reload();
  }

  return (
    <div className="px-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Projects
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="New project"
          title="New project"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>

      {creating && (
        <div className="flex gap-1 pb-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
            placeholder="Project name"
            maxLength={80}
            aria-label="Project name"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring/60"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={create}
            disabled={!name.trim() || busy}
          >
            Add
          </Button>
        </div>
      )}

      {loading && projects.length === 0 && (
        <div className="h-7 animate-pulse rounded-md bg-muted/50" aria-busy="true" />
      )}

      {projects.length > 0 && (
        <ul className="space-y-0.5">
          {projects.map((project) => {
            const active = selectedId === project.id;
            const isEditing = editing === project.id;

            if (isEditing) {
              return (
                <li key={project.id} className="flex flex-col gap-1 py-0.5">
                  <textarea
                    autoFocus
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={3}
                    aria-label={`Instructions for ${project.name}`}
                    placeholder="What should every chat in this project know?"
                    className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring/60"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      aria-label="Cancel"
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                    >
                      <X className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveInstructions(project.id)}
                      aria-label="Save instructions"
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                    >
                      <Check className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li key={project.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : project.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px]",
                    "transition-colors hover:bg-accent/60",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active && "bg-accent font-medium",
                  )}
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{project.name}</span>
                  {project.conversationCount > 0 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {project.conversationCount}
                    </span>
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`Actions for ${project.name}`}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(project.id);
                        setInstructions(project.instructions ?? "");
                      }}
                    >
                      <Pencil className="mr-2 size-3.5" />
                      Instructions
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push(`/chat?project=${project.id}`)}>
                      <Folder className="mr-2 size-3.5" />
                      New chat here
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void archive(project)}>
                      <Trash2 className="mr-2 size-3.5" />
                      Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
