"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface NoteItem {
  id: string;
  authorUsername: string;
  body: string;
  kind: string;
  pinned: boolean;
  createdAt: string;
}

const KINDS = ["note", "payment", "subscription", "abuse"] as const;

/**
 * AccountNotes — the note the next operator needs.
 *
 * NOT the audit trail. `audit_log` is structured and read through prefix
 * filters; it cannot hold "called them, they paid by cash at the post office"
 * without degrading into a free-text log. This is the human note; the audit row
 * is the record.
 *
 * APPEND-AND-PIN ONLY. There is no edit and no delete: a wrong note is
 * corrected by a later one, exactly as a credit note corrects a refund. Pinned
 * notes sort first, so "chargeback risk" does not scroll away.
 */
export function AccountNotes({
  orgId,
  notes,
  canWrite,
}: {
  orgId: string;
  notes: NoteItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<string>("note");
  const [busy, setBusy] = React.useState<string | null>(null);

  async function add() {
    const text = body.trim();
    if (!text) return;

    setBusy("new");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, kind }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That note could not be saved.");
        return;
      }
      setBody("");
      toast.success("Note saved.");
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was saved.");
    } finally {
      setBusy(null);
    }
  }

  async function togglePin(note: NoteItem) {
    setBusy(note.id);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That change could not be applied.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      {canWrite ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <label htmlFor="note-body" className="sr-only">
            Note
          </label>
          <textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Called the customer: they paid by cash at the post office, approving manually."
            rows={3}
            maxLength={4000}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              aria-label="Note kind"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={busy !== null || body.trim().length === 0} onClick={add}>
              {busy === "new" ? "Saving…" : "Add note"}
            </Button>
          </div>
        </div>
      ) : null}

      {notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No notes on this account yet.
        </p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border p-3 text-sm ${
                n.pinned ? "border-foreground/30 bg-muted/40" : "border-border bg-card"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {n.pinned ? <Pin className="size-3" aria-label="pinned" /> : null}
                <Badge variant="outline" className="text-[10px]">
                  {n.kind}
                </Badge>
                <span className="font-medium text-foreground">{n.authorUsername}</span>
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-6 px-2"
                    disabled={busy !== null}
                    onClick={() => togglePin(n)}
                    aria-label={n.pinned ? "Unpin note" : "Pin note"}
                  >
                    {n.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
