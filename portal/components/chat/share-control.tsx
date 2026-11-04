"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Check, Copy, Link2, Lock, Share2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiSend } from "@/lib/api/use-api";
import { cn } from "@/lib/utils";

/**
 * Share control (audit #11).
 *
 * THE URL IS SHOWN ONCE. The server stores a sha256 of the token, never the
 * token, so there is no endpoint that can reproduce this link — which is the
 * whole point (a database dump yields no working links). The UI therefore
 * has to be explicit rather than a copy button that implies "you can come
 * back for this later": the dialog says so, and the field is read-only and
 * selectable.
 *
 * REVOKE IS ALWAYS AVAILABLE while a link is live. A share you cannot
 * un-share is a data-retention incident, so the same control that created it
 * is the one that kills it.
 *
 * Only rendered on a conversation route. A share of `/chat` would be a share
 * of nothing.
 */
export function ShareControl({ temporary = false }: { temporary?: boolean }) {
  const pathname = usePathname();
  const conversationId = React.useMemo(() => {
    const match = /^\/chat\/([0-9a-f-]{36})$/i.exec(pathname);
    return match?.[1] ?? null;
  }, [pathname]);

  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [shareId, setShareId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Closing without revoking keeps the link alive on purpose: the user may
  // still be pasting it. "Stop sharing" is its own explicit action.
  React.useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  if (!conversationId) return null;

  // A temporary chat is never shareable — the user asked for it not to be
  // saved, and a public URL is the opposite of that.
  if (temporary) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        title="Temporary chats cannot be shared"
      >
        <Lock className="size-3" aria-hidden />
        Private
      </span>
    );
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    const res = await apiSend<{ url: string; share: { id: string } }>(
      `/api/chat/conversations/${conversationId}/share`,
      { method: "POST", body: {} },
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    // Absolute, because this is going into a chat with someone else.
    setUrl(`${window.location.origin}${res.data.url}`);
    setShareId(res.data.share.id);
    setCopied(false);
  }

  async function revoke() {
    if (!shareId) return;
    const res = await apiSend(
      `/api/chat/conversations/${conversationId}/share?shareId=${shareId}`,
      { method: "DELETE" },
    );
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    setUrl(null);
    setShareId(null);
    toast.success("Link revoked. It no longer opens anything.");
    setOpen(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Revert the tick so a second copy still gives feedback.
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Your browser blocked the clipboard. Select the link and copy it manually.");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Share2 className="size-3.5" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Share this conversation"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-popover p-4 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold">Share this conversation</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Anyone with the link can read it. Nothing else in your account is
                  included.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {url ? (
              <div className="mt-3 space-y-3">
                <div className="flex gap-1.5">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Share link"
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-[11px] outline-none"
                  />
                  <Button size="sm" className="h-8 gap-1 px-2" onClick={copy}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
                  Copy it now. This link is stored only as a hash, so it cannot be shown
                  again — if you lose it, revoke and make a new one.
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={revoke}>
                    Stop sharing
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  onClick={share}
                  disabled={busy}
                  className={cn("gap-1.5", busy && "opacity-70")}
                >
                  <Link2 className="size-3.5" />
                  {busy ? "Creating…" : "Create link"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
