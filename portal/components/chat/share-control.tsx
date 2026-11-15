"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Check, Copy, Link2, Lock, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiSend, useApi } from "@/lib/api/use-api";
import { cn } from "@/lib/utils";

interface ShareRow {
  id: string;
  /** Follows the conversation instead of freezing at creation. */
  isLive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

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
 * A LIVE LINK IS KNOWN, EVEN IF THE URL IS NOT. `GET` returns the shares
 * that are still valid (id, expiry, view count) without the token, so
 * reopening the dialog after closing it shows "public until Thursday" and a
 * working Stop sharing — previously the panel reset to "Create link" and
 * creating another one silently revoked the first. The URL is still lost;
 * the state is not.
 *
 * REVOKE IS ALWAYS AVAILABLE while a link is live. A share you cannot
 * un-share is a data-retention incident, so the same control that created it
 * is the one that kills it.
 */
export function ShareControl() {
  const pathname = usePathname();
  const [known, setKnown] = React.useState<string | null>(null);
  const [temporary, setTemporary] = React.useState(false);

  /*
   * The conversation id, from three sources, because the first one is not
   * enough. `usePathname` is the router's view of the URL, and the chat
   * rewrites the URL with `history.replaceState` when the first send creates
   * the row — that does not necessarily re-render this component. So the
   * chat also announces the id on the same DOM channel it uses for the
   * title, and this listens.
   */
  const fromPath = React.useMemo(() => {
    const match = /^\/chat\/([0-9a-f-]{36})$/i.exec(pathname);
    return match?.[1] ?? null;
  }, [pathname]);

  React.useEffect(() => {
    function onIdentity(e: Event) {
      const detail = (e as CustomEvent<{ conversationId?: string | null; temporary?: boolean }>)
        .detail;
      if (detail?.conversationId) setKnown(detail.conversationId);
      setTemporary(detail?.temporary === true);
    }
    window.addEventListener("chat:title", onIdentity);
    return () => window.removeEventListener("chat:title", onIdentity);
  }, []);

  /*
   * A route change drops state that belonged to the previous conversation.
   * The chat re-announces itself immediately after (its effects run after
   * this one — the header mounts first), so this cannot leave a temporary
   * chat looking shareable.
   */
  React.useEffect(() => {
    setKnown(null);
    setTemporary(false);
  }, [pathname]);

  const conversationId = fromPath ?? known;

  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  /**
   * Live is OFF by default and is chosen BEFORE the link is made, because it
   * cannot be changed afterwards — the token is shown once and never stored,
   * so there is no way to re-open this dialog and flip a mode on a link whose
   * URL the user has already sent to someone.
   */
  const [wantLive, setWantLive] = React.useState(false);
  const [createdLive, setCreatedLive] = React.useState(false);
  const [shareId, setShareId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Fetched only while the dialog is open: the header renders on every
  // conversation and a share lookup on each of them is a query nobody asked
  // for.
  const live = useApi<{ shares: ShareRow[] }>(
    open && conversationId ? `/api/chat/conversations/${conversationId}/share` : null,
  );
  const existing = live.data?.shares?.[0] ?? null;

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

  function close() {
    setOpen(false);
    // The one-time URL is not remembered across openings; the link itself
    // is, via `live`. Clearing it stops a stale URL from being copied after
    // it was revoked elsewhere.
    setUrl(null);
    setShareId(null);
    setCopied(false);
  }

  async function share() {
    if (busy || !conversationId) return;
    setBusy(true);
    const res = await apiSend<{ url: string; share: { id: string; isLive: boolean } }>(
      `/api/chat/conversations/${conversationId}/share`,
      // `isLive` is sent explicitly rather than omitted: the server defaults
      // it to false, and a body that says nothing is indistinguishable from a
      // client that did not know the option exists.
      { method: "POST", body: { isLive: wantLive } },
    );
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    // Absolute, because this is going into a chat with someone else.
    setUrl(`${window.location.origin}${res.data.url}`);
    setShareId(res.data.share.id);
    setCreatedLive(res.data.share.isLive === true);
    setCopied(false);
    live.reload();
  }

  async function revoke(target: string | null) {
    if (!target || !conversationId) return;
    const res = await apiSend(
      `/api/chat/conversations/${conversationId}/share?shareId=${target}`,
      { method: "DELETE" },
    );
    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    setUrl(null);
    setShareId(null);
    live.reload();
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

  const liveId = shareId ?? existing?.id ?? null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        // The visible label is `hidden` below `sm`, which leaves the icon
        // with no accessible name on exactly the devices that have no room
        // for one. `aria-label` is what a screen reader reads there.
        aria-label="Share this conversation"
        className="h-9 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground sm:h-7"
      >
        <Share2 className="size-3.5" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      {/*
        A real Dialog, not a hand-rolled overlay. The header it mounts inside
        carries `backdrop-blur-xl`, and a backdrop filter makes an element a
        containing block for `position: fixed` — so a `fixed inset-0` overlay
        anchored to the 52px header strip instead of the viewport. Base UI's
        popup renders through a portal, which is the only version that lands
        over the page.
      */}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share this conversation</DialogTitle>
            <DialogDescription>
              Anyone with the link can read it. Nothing else in your account is included.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0">
            {url ? (
              <div className="space-y-3">
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
                {createdLive ? (
                  <p className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-[11px] leading-relaxed text-success">
                    Live. New messages in this chat appear to whoever opens the link, until
                    you stop sharing or it expires.
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-warning">
                    Snapshot. Replies you send from now on are NOT included.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-warning">
                  Copy it now. This link is stored only as a hash, so it cannot be shown
                  again — if you lose it, revoke and make a new one.
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => revoke(liveId)}>
                    Stop sharing
                  </Button>
                </div>
              </div>
            ) : existing ? (
              /* A live link whose token this browser no longer has. The URL
                 cannot be shown, but the link working — and stopping it — is
                 the part that matters. */
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  This conversation is public
                  {existing.expiresAt
                    ? ` until ${new Date(existing.expiresAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : ""}
                  . The link itself cannot be shown again.
                </p>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => revoke(existing.id)}>
                    Stop sharing
                  </Button>
                  <Button size="sm" onClick={share} disabled={busy} className="gap-1.5 px-2">
                    <Link2 className="size-3.5" />
                    {busy ? "Creating…" : "Replace link"}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Replacing revokes the current link and makes a new one you can copy.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/*
                  THE CHOICE IS MADE BEFORE THE LINK EXISTS, because it cannot
                  be changed after: the token is shown once and stored only as
                  a hash, so there is no dialog to re-open and no row to flip.
                  Choosing afterwards would mean revoking a link someone has
                  already been sent.
                */}
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border/60 p-2.5">
                  <input
                    type="checkbox"
                    checked={wantLive}
                    onChange={(e) => setWantLive(e.target.checked)}
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">
                      Follow the conversation live
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                      {wantLive
                        ? "Every message you send while this link is active appears to whoever holds it. Stop sharing to end it."
                        : "Freezes at the newest message. Replies you send after creating it stay private."}
                    </span>
                  </span>
                </label>

                {wantLive ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
                    A live link keeps publishing until you stop it. If you forget it,
                    everything you say in this chat is readable by anyone holding the URL
                    until it expires.
                  </p>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={share}
                    disabled={busy || live.loading}
                    className={cn("gap-1.5", busy && "opacity-70")}
                  >
                    <Link2 className="size-3.5" />
                    {busy ? "Creating…" : wantLive ? "Create live link" : "Create link"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
