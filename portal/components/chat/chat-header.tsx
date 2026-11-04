"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ShareControl } from "@/components/chat/share-control";

/**
 * ChatHeader — a slim bar, not the dashboard's.
 *
 * The dashboard header carries a page title, a ⌘K search and a spend
 * readout; none of that belongs above a conversation. What the chat needs
 * is the shell trigger, the current surface's name, and a way back.
 *
 * NO SETTINGS/KEYS ICONS HERE. Both already sit in the sidebar footer as
 * labelled rows, which is where a destination belongs — duplicating them
 * as unlabelled icon buttons in the header gave the same route two
 * different affordances and made the bar look busier than the content it
 * frames. The bar now holds one control and one title.
 */
export function ChatHeader({ title }: { title?: string | null } = {}) {
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/settings");
  const [liveTitle, setLiveTitle] = React.useState<string | null>(title ?? null);

  /*
   * The header lives in the LAYOUT, so it cannot be handed the page's title
   * as a prop — the two render as siblings. It is told instead, by a DOM
   * event, exactly as the sidebar is told about a new conversation. A
   * context would exist only to carry one string, and a second fetch of the
   * conversation list here would be a request per navigation.
   *
   * Cleared on every pathname change so a stale title cannot follow the
   * reader from one chat to the next.
   */
  React.useEffect(() => {
    setLiveTitle(null);
    function onTitle(e: Event) {
      const detail = (e as CustomEvent<{ title?: string | null }>).detail;
      setLiveTitle(detail?.title ?? null);
    }
    window.addEventListener("chat:title", onTitle);
    return () => window.removeEventListener("chat:title", onTitle);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sm:px-3">
      <SidebarTrigger
        aria-label="Toggle conversations"
        className="text-muted-foreground hover:text-foreground"
      />
      {/*
        The conversation's own title, not the word "Chat". With a sidebar of
        similarly-named threads there was no way to tell which one was open
        once the transcript scrolled past its first question.
      */}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em]">
        {onSettings ? "Settings" : (liveTitle || title || "New chat")}
      </span>
      {!onSettings ? <ShareControl /> : null}
      {onSettings ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          nativeButton={false}
          render={<Link href="/chat" />}
        >
          Back to chat
        </Button>
      ) : null}
    </header>
  );
}
