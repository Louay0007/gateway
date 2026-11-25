"use client";

import * as React from "react";
import { Radio } from "lucide-react";

import { Markdown } from "@/components/ai/markdown";
import { cn } from "@/lib/utils";

/**
 * The public view of a live shared conversation.
 *
 * WHY A CLIENT COMPONENT AT ALL. The page is server-rendered with the
 * snapshot it already has, so a reader sees the conversation without any
 * JavaScript. This component then upgrades it: it opens an EventSource and
 * appends what arrives. With JS disabled the transcript is still complete
 * as of page load — the feature degrades to "refresh to see more", not to
 * a blank page.
 *
 * WHAT IT TRUSTS. Nothing. Every frame is data from our own route, and the
 * route re-resolves the share token on every tick, so the only thing this
 * decides is WHEN to stop: `end` with `gone` means the link died and the
 * page must say so rather than keep polling a URL that will never answer
 * again.
 *
 * WHY WHOLE MESSAGES. The server sends a message only once it is complete,
 * so a viewer never watches an answer mutate under them. It also means
 * reasoning and cost — which are not in the shared row — cannot leak
 * through a delta stream that was never built to carry them.
 */

export interface SharedLiveMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

type StreamFrame =
  | { type: "snapshot"; title: string; isLive: boolean; messages: SharedLiveMessage[] }
  | { type: "messages"; messages: SharedLiveMessage[] }
  | { type: "end"; reason: "snapshot" | "gone" | "reconnect" };

export function SharedLive({
  token,
  initial,
  isLive,
}: {
  token: string;
  initial: SharedLiveMessage[];
  isLive: boolean;
}) {
  const [messages, setMessages] = React.useState<SharedLiveMessage[]>(initial);
  const [ended, setEnded] = React.useState<null | "gone" | "reconnect">(null);
  const seen = React.useRef<Set<string>>(new Set(initial.map((m) => m.id)));

  React.useEffect(() => {
    // A snapshot share has no future to follow, and the route closes the
    // stream immediately — no point opening one.
    if (!isLive) return;

    const source = new EventSource(`/api/share/${token}/stream`);

    source.onmessage = (event) => {
      let frame: StreamFrame;
      try {
        frame = JSON.parse(event.data) as StreamFrame;
      } catch {
        // A malformed frame is skipped rather than crashing the page. There
        // is no user action that could fix it, and the next tick is likely
        // fine.
        return;
      }

      if (frame.type === "snapshot") {
        // The route's first frame is authoritative: it may carry messages
        // that landed between the server render and this connection.
        const fresh = frame.messages.filter((m) => !seen.current.has(m.id));
        if (fresh.length > 0) {
          for (const m of fresh) seen.current.add(m.id);
          setMessages((prev) => [...prev, ...fresh]);
        }
        return;
      }

      if (frame.type === "messages") {
        // Deduplicated by id. A reconnect replays from the cursor, and the
        // snapshot above can overlap with what the server already rendered.
        const fresh = frame.messages.filter((m) => !seen.current.has(m.id));
        if (fresh.length === 0) return;
        for (const m of fresh) seen.current.add(m.id);
        setMessages((prev) => [...prev, ...fresh]);
        return;
      }

      if (frame.type === "end") {
        source.close();
        if (frame.reason === "gone") setEnded("gone");
        // `reconnect` means our own ten-minute cap: EventSource reconnects
        // on its own, and a new stream re-checks the token.
        if (frame.reason === "reconnect") setEnded("reconnect");
      }
    };

    source.onerror = () => {
      // EventSource retries by itself. The one case it cannot recover from
      // is a 404 — a token that no longer resolves — and that arrives as a
      // closed connection after our route has already sent `end`.
      if (source.readyState === EventSource.CLOSED) {
        setEnded((prev) => prev ?? "gone");
      }
    };

    return () => source.close();
  }, [token, isLive]);

  return (
    <>
      {isLive ? (
        <p
          role="status"
          className={cn(
            "mb-6 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px]",
            ended === "gone"
              ? "border-border bg-muted text-muted-foreground"
              : "border-success/30 bg-success/10 text-success",
          )}
        >
          <Radio
            className={cn("size-3", ended === null && "animate-pulse motion-reduce:animate-none")}
            aria-hidden
          />
          {ended === "gone"
            ? "This link has ended"
            : ended === "reconnect"
              ? "Reconnecting…"
              : "Live — new messages appear as they are sent"}
        </p>
      ) : null}

      <div className="flex flex-col gap-9">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex w-full flex-col items-end">
              <div className="max-w-[95%] rounded-2xl bg-secondary px-4.5 py-3 text-[15px] leading-[1.65] whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={message.id} className="w-full">
              <Markdown>{message.content}</Markdown>
            </div>
          ),
        )}
      </div>

      {messages.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          This conversation has no messages to show.
        </p>
      )}
    </>
  );
}
