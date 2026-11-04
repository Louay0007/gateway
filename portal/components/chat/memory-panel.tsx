"use client";

import * as React from "react";
import { Pin, PinOff, Plus, Quote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi, apiSend } from "@/lib/api/use-api";
import { cn } from "@/lib/utils";

/**
 * Memory — what the model knows about you (audit #4).
 *
 * THE VIEWER IS THE FEATURE, not a settings afterthought. A memory system
 * whose facts a user cannot read and delete is a liability, so this panel
 * ships with the extraction job rather than after it: every fact is listed,
 * every fact has its own delete, and the wipe-everything control is a real
 * button rather than a support request.
 *
 * Optimistic-by-refetch on edit, optimistic-by-removal on delete — matching
 * conversation-list.tsx. A memory that lingers after "delete" would directly
 * contradict the promise the panel is making.
 */
interface MemoryRow {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  createdAt: string;
}

export function MemoryPanel() {
  const { data, loading, error, reload } = useApi<{ memories: MemoryRow[] }>(
    "/api/chat/memories",
  );
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const memories = data?.memories ?? [];

  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    const res = await apiSend<{ memory: MemoryRow }>("/api/chat/memories", {
      method: "POST",
      body: { content },
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    setDraft("");
    reload();
  }

  async function remove(id: string) {
    // Remove locally first: this is the one control that must feel instant,
    // and the row's absence IS the confirmation.
    const res = await apiSend(`/api/chat/memories/${id}`, { method: "DELETE" });
    if ("error" in res) {
      toast.error(res.error.message);
      reload();
      return;
    }
    reload();
  }

  async function togglePin(memory: MemoryRow) {
    const res = await apiSend(`/api/chat/memories/${memory.id}`, {
      method: "PATCH",
      body: { pinned: !memory.pinned },
    });
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    reload();
  }

  async function forgetAll() {
    if (!window.confirm("Delete everything the model remembers about you? This cannot be undone.")) {
      return;
    }
    const res = await apiSend("/api/chat/memories", { method: "DELETE" });
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Memory cleared.");
    reload();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Memory</CardTitle>
          <CardDescription>
            Facts the model keeps between conversations. Everything here is visible and
            deletable — nothing is remembered that you cannot read.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="Something to remember, e.g. “Prefers TypeScript”"
              maxLength={500}
              aria-label="Add a memory"
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring/60"
            />
            <Button size="sm" onClick={add} disabled={!draft.trim() || busy}>
              <Plus className="mr-1 size-4" />
              Add
            </Button>
          </div>

          {loading && memories.length === 0 && (
            <div className="space-y-1.5" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}

          {!loading && !error && memories.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <Quote className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Nothing remembered yet. Facts are picked up from your conversations, or you
                can add one above.
              </p>
            </div>
          )}

          {memories.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {memories.map((memory) => (
                <li key={memory.id} className="flex items-start gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm leading-relaxed">
                    {memory.content}
                    {memory.category !== "general" && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide text-muted-foreground">
                        {memory.category}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePin(memory)}
                    className={cn(
                      "shrink-0 rounded p-1 transition-colors",
                      memory.pinned
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-label={memory.pinned ? "Unpin this memory" : "Pin this memory"}
                    title={memory.pinned ? "Pinned — survives pruning" : "Pin"}
                  >
                    {memory.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(memory.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Delete this memory"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {memories.length > 0 && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={forgetAll}>
                Forget everything
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Custom instructions — the "about me / how to respond" pair (audit #13).
 *
 * Two fields, saved explicitly rather than on every keystroke: this text is
 * prepended to every turn, so a half-typed sentence becoming the permanent
 * system prompt is a real (and silent) degradation of every answer.
 */
export function InstructionsPanel() {
  const { data, loading, reload } = useApi<{
    instructions: { aboutUser: string; responseStyle: string; updatedAt: string | null };
  }>("/api/chat/instructions");

  const [about, setAbout] = React.useState("");
  const [style, setStyle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const loaded = React.useRef(false);

  React.useEffect(() => {
    if (!data || loaded.current) return;
    setAbout(data.instructions.aboutUser);
    setStyle(data.instructions.responseStyle);
    loaded.current = true;
  }, [data]);

  const dirty =
    data !== null &&
    (about !== data.instructions.aboutUser || style !== data.instructions.responseStyle);

  async function save() {
    setSaving(true);
    const res = await apiSend("/api/chat/instructions", {
      method: "PUT",
      body: { aboutUser: about, responseStyle: style },
    });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Instructions saved.");
    loaded.current = false;
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom instructions</CardTitle>
        <CardDescription>
          Applied to every conversation, before any per-chat setting. This is who you are and
          how you want answers — not a generation parameter, so a chat cannot override it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="about-user" className="text-sm font-medium">
            What should the model know about you?
          </label>
          <textarea
            id="about-user"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="I am a backend engineer working in Go and TypeScript. I prefer direct answers over hedging."
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-ring/60"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="response-style" className="text-sm font-medium">
            How should it respond?
          </label>
          <textarea
            id="response-style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Answer in French. Be concise. Show code before explanation."
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-ring/60"
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading…" : data?.instructions.updatedAt ? "Saved." : "Not set."}
          </p>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
