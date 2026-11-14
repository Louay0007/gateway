"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Globe,
  Pin,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ai/markdown";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Message, MessageActions, MessageContent } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Loader } from "@/components/ui/loader";
import { Reasoning } from "@/components/ai/reasoning";
import { Sources, type SourceItem } from "@/components/ai/sources";
import { Suggestion } from "@/components/ai/suggestion";
import { PromptInput, AttachControl } from "@/components/ai/prompt-input";
import {
  AttachmentRow,
  type AttachmentChip,
  formatChars,
  guessKind,
} from "@/components/ai/attachment";
import { ModelPicker, type ModelOption } from "@/components/chat/model-picker";
import { QuotaHint } from "@/components/chat/quota-hint";
import { aliasMeta } from "@/components/chat/aliases";
import { MAX_ATTACHMENTS } from "@/lib/chat/attachments";
import { cn } from "@/lib/utils";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Deliberation, rendered collapsed and never concatenated into `content`. */
  reasoning?: string;
  /** Set once the turn is finished and the ledger has a row for it. */
  finish?: "stop" | "length" | "aborted" | "error";
  /**
   * The server's own stop reason, passed through untouched. `finish` is the
   * view's coarse state; this is why it stopped, which is what tells a
   * truncated answer apart from a complete one.
   */
  finishReason?: string;
  /** Per-turn numbers, from the `usage` frame or the stored row. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  /** Files this turn carried, for the chip row under the bubble. */
  attachments?: { id: string; filename: string; kind: string; chars?: number }[];
  /** Third-party pages this turn consulted, when web search ran. */
  sources?: SourceItem[];
}

export interface ChatViewProps {
  /** Every entitled alias, spent ones included, from `getAllowedModels`. */
  options: ModelOption[];
  /** The aliases the server will actually accept right now. */
  allowed: string[];
  /** End of the current quota window, already formatted (Tunis). */
  resetsAt: string | null;
  /** No plan at all: the composer stays live, the send explains itself. */
  hasPlan: boolean;
  /** Whether this deploy can search the web. */
  searchAvailable?: boolean;
  /** Open this conversation as temporary (no memory, no index, no share). */
  temporary?: boolean;
  /** File the chat under this project when the first send creates it. */
  projectId?: string | null;
  /** Conversation title, for the header. Omitted on a new chat. */
  title?: string | null;
  conversationId?: string;
  /** Prior turns, when reopening a conversation. Read on the server. */
  initialMessages?: ChatMessage[];
}

/**
 * ChatView — the conversation.
 *
 * THE SHAPE (shadcn.io Chat anatomy):
 *
 *   MessageScrollerProvider        owns scroll: anchoring, following, jump
 *   └── MessageScroller
 *       ├── MessageScrollerViewport   the scrollable region ("Messages")
 *       │   └── MessageScrollerContent  the log, aria-busy while streaming
 *       │       └── MessageScrollerItem per turn, anchored on the person's
 *       └── MessageScrollerButton      "jump to latest", inert at the edge
 *
 * The person's turn is a Bubble on `align="end"`; the reply has NO bubble —
 * an answer is a document (headings, lists, tables, code) and boxing it
 * puts a border around every paragraph and narrows it below the width of
 * the composer it was written in.
 *
 * TRANSPORT is `fetch` + `ReadableStream`, not `EventSource`: the latter
 * cannot POST and cannot carry the session. Each frame is `data: <json>\n\n`.
 *
 * THREE STATES ARE LOAD-BEARING:
 *
 *   - STREAMING: the bubble exists and grows, the log is `aria-busy` so a
 *     screen reader is not read every token.
 *   - ABORTED: whatever arrived is kept and marked cut short. Dropping a
 *     half answer the user was reading is data loss; calling it complete is
 *     a lie.
 *   - REFUSED (402): the server's own sentence plus a link to the plan tab.
 *     Never a paywall in front of the composer — the user finds out by
 *     asking, which is the point of auth-first.
 */
export function ChatView({
  options,
  allowed,
  resetsAt,
  hasPlan,
  conversationId,
  initialMessages,
  title,
  searchAvailable = false,
  temporary = false,
  projectId = null,
}: ChatViewProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages ?? []);
  const [alias, setAlias] = React.useState<string | null>(allowed[0] ?? null);
  const [draft, setDraft] = React.useState<string>("");
  const lastSent = React.useRef<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [failure, setFailure] = React.useState<{ message: string; paywall: boolean } | null>(null);
  const [chips, setChips] = React.useState<AttachmentChip[]>([]);
  const [webSearch, setWebSearch] = React.useState(false);
  // Deep reads the pages the search found. Independent of the search toggle
  // only in the UI — the server ignores it unless a search runs, so turning
  // it on first and search on second is not a broken state.
  const [deepSearch, setDeepSearch] = React.useState(false);
  const uploading = chips.some((c) => c.status === "uploading");

  const abortRef = React.useRef<AbortController | null>(null);
  const activeId = React.useRef<string | null>(conversationId ?? null);

  /**
   * REVERT. Rewind the thread to one of the person's own turns: that turn and
   * everything after it disappear, and its text comes back to the composer so
   * they can fix what they actually meant to say.
   *
   * `revertTarget` is the turn waiting in the confirmation dialog — reverting
   * is destructive to the screen (the answer being read vanishes) so it must
   * not fire on a stray click. `reverted` is the last one applied, held so the
   * toast's Undo can put the rows back without a round trip. `null` once the
   * person sends again, because from that point the tail is stale and
   * re-inserting it would put turns after a turn that came later.
   */
  const [revertTarget, setRevertTarget] = React.useState<{
    messageId: string;
    content: string;
    hides: number;
  } | null>(null);
  const [reverting, setReverting] = React.useState(false);
  const reverted = React.useRef<{ batchId: string; tail: ChatMessage[] } | null>(null);
  /**
   * The bar offering to take the last revert back. Held in state because it is
   * RENDERED, not toasted: a toast lands bottom-right, which is exactly where
   * the composer's send button is, so "Your text is back" covered the thing it
   * was talking about. A strip directly above the composer names the action
   * and sits next to what it undoes.
   *
   * It outlives a rewrite of the thread but not the person sending again: once
   * they re-ask, the rewind is the history they chose.
   */
  const [undoOffer, setUndoOffer] = React.useState<{ batchId: string; hides: number } | null>(
    null,
  );

  // ponytail: the reverted text and the undo offer survive a reload in
  // sessionStorage, not in the database — the TAIL cannot, because it is only
  // ever read from the server. Good enough until someone asks for undo after
  // closing the tab, which needs the batch id on the conversation row.
  const revertKey = conversationId ? `revert:${conversationId}` : null;
  React.useEffect(() => {
    if (!revertKey) return;
    const held = window.sessionStorage.getItem(revertKey);
    if (!held) return;
    window.sessionStorage.removeItem(revertKey);
    try {
      const saved = JSON.parse(held) as { draft: string; batchId: string; hides: number };
      setDraft((prev) => prev || saved.draft);
      setUndoOffer({ batchId: saved.batchId, hides: saved.hides });
    } catch {
      // A malformed value is not worth a broken page.
    }
  }, [revertKey]);

  async function applyRevert() {
    const target = revertTarget;
    const id = activeId.current;
    if (!target || !id || reverting) return;
    setReverting(true);
    try {
      const res = await fetch(`/api/chat/conversations/${id}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: target.messageId }),
      });
      if (!res.ok) {
        toast.error("Could not revert this chat. Try again.");
        return;
      }
      const body = (await res.json()) as { batchId: string };

      // The rows stay in the database — they were billed, and the ledger has
      // to agree with the transcript. The server hides them; this mirrors it
      // locally so the screen does not need a reload to show the rewind.
      //
      // The tail is captured from `messages`, NOT inside the state updater:
      // React may run an updater more than once, and writing a ref from in
      // there would be a side effect in the render phase.
      const at = messages.findIndex((m) => m.id === target.messageId);
      if (at >= 0) {
        reverted.current = { batchId: body.batchId, tail: messages.slice(at) };
        setMessages(messages.slice(0, at));
      }
      setDraft(target.content);
      // The dialog confirms, then the screen changes under it — so if the
      // person reloads before sending, the sentence they meant to fix has to
      // still be in the composer rather than gone with the client state.
      if (revertKey) {
        window.sessionStorage.setItem(
          revertKey,
          JSON.stringify({ draft: target.content, batchId: body.batchId, hides: target.hides }),
        );
      }
      setUndoOffer({ batchId: body.batchId, hides: target.hides });
      setRevertTarget(null);
    } catch {
      toast.error("Could not revert this chat. Try again.");
    } finally {
      setReverting(false);
    }
  }

  async function undoRevert(batchId: string) {
    const id = activeId.current;
    if (!id) return;
    const res = await fetch(`/api/chat/conversations/${id}/revert?batchId=${batchId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Could not undo. Reload the chat to see it restored.");
      return;
    }
    // After a reload the tail is not in memory — only the server has it — so
    // re-reading the page is the honest way back.
    const held = reverted.current;
    reverted.current = null;
    if (revertKey) window.sessionStorage.removeItem(revertKey);
    setUndoOffer(null);
    if (held && held.batchId === batchId) {
      setMessages((prev) => [...prev, ...held.tail]);
    } else {
      window.location.reload();
    }
  }

  // Tell the header which conversation is open. The header lives in the
  // layout and cannot be handed a page prop, so this is the same DOM-event
  // channel the sidebar already uses for a newly created conversation.
  React.useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("chat:title", {
        detail: { title: title ?? null, conversationId: conversationId ?? null, temporary },
      }),
    );
  }, [title, conversationId, temporary]);

  const upload = React.useCallback(async (all: File[]) => {
    // Enforce the cap HERE as well as on the server, and say so on a chip.
    //
    // The server refuses a sixth id outright, which would fail the whole
    // turn. Deciding locally means the five that fit still upload and the
    // surplus becomes a dismissible error chip the user can see and clear —
    // silently dropping files is how someone believes they sent a spec
    // sheet that was never attached.
    // `chips` is a dependency of this callback for exactly this read. The
    // cap must be counted against the chips that exist now; a stable
    // callback closing over an older list would let a second drop in the
    // same tick count the first batch as absent and overflow the cap.
    const room = MAX_ATTACHMENTS - chips.filter((c) => c.status !== "error").length;
    const accepted = all.slice(0, Math.max(room, 0));
    const rejected = all.slice(accepted.length);

    if (rejected.length > 0) {
      setChips((prev) => [
        ...prev,
        ...rejected.map((file) => ({
          localId: crypto.randomUUID(),
          status: "error" as const,
          filename: file.name,
          error:
            room <= 0
              ? `Up to ${MAX_ATTACHMENTS} files per message. Remove one to add this.`
              : `Up to ${MAX_ATTACHMENTS} files per message — this one was not added.`,
        })),
      ]);
    }

    for (const file of accepted) {
      const localId = crypto.randomUUID();
      setChips((prev) => [...prev, { localId, status: "uploading", filename: file.name }]);

      const form = new FormData();
      form.append("file", file, file.name);

      try {
        const res = await fetch("/api/attachments", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as
          | {
              attachment?: { id: string; kind: string; chars: number; truncated: boolean; filename: string };
              error?: { message?: string };
            }
          | null;

        if (!res.ok || !body?.attachment) {
          setChips((prev) =>
            prev.map((c) =>
              c.localId === localId
                ? { ...c, status: "error", error: body?.error?.message ?? "Upload failed." }
                : c,
            ),
          );
          continue;
        }

        const a = body.attachment;
        setChips((prev) =>
          prev.map((c) =>
            c.localId === localId
              ? {
                  ...c,
                  status: "ready",
                  id: a.id,
                  kind: a.kind,
                  chars: a.chars,
                  truncated: a.truncated,
                  filename: a.filename,
                }
              : c,
          ),
        );
      } catch {
        setChips((prev) =>
          prev.map((c) =>
            c.localId === localId
              ? { ...c, status: "error", error: "We could not reach the server." }
              : c,
          ),
        );
      }
    }
  }, [chips]);

  async function send(text: string, opts: { regenerate?: boolean } = {}) {
    if (streaming) return;
    const regenerate = opts.regenerate === true && Boolean(activeId.current);
    if (!regenerate && !text.trim()) return;
    setFailure(null);

    if (!regenerate) lastSent.current = text;

    // Sending after a revert joins fresh rows behind the truncated head, so
    // the held tail is no longer contiguous with the thread and Undo would
    // splice turns in out of order. The rows stay recoverable server-side;
    // only the one-click undo goes away, which is the honest trade.
    reverted.current = null;
    if (revertKey) window.sessionStorage.removeItem(revertKey);
    setUndoOffer(null);

    // Only READY files ride this turn. An upload still in flight is dropped
    // from the payload rather than blocking the send: the user's sentence is
    // worth more than the file, and the chip stays visible so they can retry
    // it on the next turn. (The composer's submit is deliberately NOT gated
    // on `uploading` for the same reason.)
    const readyFiles = regenerate ? [] : chips.filter((c) => c.status === "ready" && c.id);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      attachments: readyFiles.map((c) => ({
        id: c.id as string,
        filename: c.filename,
        kind: c.kind ?? "text",
        chars: c.chars,
      })),
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => {
      // A regenerate replaces the answer to the LAST question; appending a
      // second user bubble would show that question twice.
      const base = regenerate
        ? prev.filter((m, i) => !(m.role === "assistant" && i === prev.length - 1))
        : [...prev, userMessage];
      return [...base, { id: assistantId, role: "assistant", content: "" }];
    });
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const append = (chunk: string) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
      );
    const appendReasoning = (chunk: string) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, reasoning: (m.reasoning ?? "") + chunk } : m,
        ),
      );
    const patch = (fields: Partial<ChatMessage>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, ...fields } : m)),
      );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId.current,
          // A null alias is still SENT as a real tier, because the point of
          // an enabled composer with no plan is that the server answers 402
          // "choose a plan". Sending null would fail body validation first
          // and the user would get "that message could not be read".
          alias: alias ?? "smart",
          ...(regenerate ? { regenerate: true } : { message: text }),
          ...(readyFiles.length > 0
            ? { attachmentIds: readyFiles.map((c) => c.id as string) }
            : {}),
          ...(webSearch && searchAvailable ? { webSearch: true } : {}),
          ...(webSearch && deepSearch && searchAvailable ? { deepSearch: true } : {}),
          ...(temporary ? { temporary: true } : {}),
          // Only on the turn that creates the row: the server ignores it
          // otherwise, and a stale query string must not re-file an
          // existing chat the user has since moved.
          ...(projectId && !activeId.current ? { projectId } : {}),
        }),
        signal: controller.signal,
      });

      // The error envelope is JSON even though success is SSE, so this
      // branch must run BEFORE any reader is attached.
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        const message =
          body?.error?.message ??
          (res.status === 402
            ? "Choose a plan to start chatting."
            : "The server could not answer. Try again in a moment.");
        setFailure({ message, paywall: res.status === 402 });
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      if (!res.body) {
        setFailure({ message: "The server sent no response body. Try again.", paywall: false });
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      // Accepted: the files belong to the turn that just went out.
      if (!regenerate) setChips([]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // The server's terminal reason. Tracked separately from the view's
      // `finish` so the "cut short" marker can distinguish a stop from a
      // truncation instead of overwriting both with "stop".
      let serverFinish: ChatMessage["finish"] | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line; anything after the last
        // blank line is a partial frame and must survive to the next read.
        // CRLF is normalized first: a `\r\n\r\n` separator contains no
        // `\n\n`, and splitting only on "\n\n" would read nothing.
        buffer = buffer.replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as {
              conversationId?: string;
              delta?: string;
              reasoning?: string;
              sources?: SourceItem[];
              error?: { message?: string };
              finish?: ChatMessage["finish"];
              usage?: {
                inputTokens?: number | null;
                outputTokens?: number | null;
                costUsd?: number | null;
              };
            };
            if (event.conversationId) activeId.current = event.conversationId;
            if (event.error?.message) {
              setFailure({ message: event.error.message, paywall: false });
            }
            if (event.delta) append(event.delta);
            if (event.reasoning) appendReasoning(event.reasoning);
            if (event.sources) patch({ sources: event.sources });
            if (event.usage) {
              patch({
                inputTokens: event.usage.inputTokens ?? null,
                outputTokens: event.usage.outputTokens ?? null,
                costUsd: event.usage.costUsd ?? null,
              });
            }
            if (event.finish) serverFinish = event.finish;
          } catch {
            // A malformed frame is dropped rather than rendered.
          }
        }
      }

      // The server's reason wins. Hard-coding "stop" here (what this used to
      // do) made a reply cut at the token limit render identically to a
      // finished one, so truncation looked like the model chose to stop
      // mid-word.
      patch({
        finish: serverFinish ?? "stop",
        finishReason: serverFinish === "length" ? "length" : undefined,
      });

      if (activeId.current && !conversationId) {
        window.history.replaceState(null, "", `/chat/${activeId.current}`);
        window.dispatchEvent(new Event("chat:conversation-created"));
        // `replaceState` does not re-render, so anything keyed on the URL
        // (the header's Share control) has to be told the row now exists.
        window.dispatchEvent(
          new CustomEvent("chat:title", {
            detail: { title: title ?? null, conversationId: activeId.current, temporary },
          }),
        );
      }
    } catch (e) {
      if (controller.signal.aborted) patch({ finish: "aborted" });
      else {
        setFailure({
          message: "We lost the connection. Your message was saved; try again.",
          paywall: false,
        });
        patch({ finish: "error" });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  const empty = messages.length === 0;

  // The dialog's "this chat" reading. Summed from the transcript because
  // that is where the numbers already are: a request for it would return a
  // subset of what these turns hold.
  const usage = React.useMemo(
    () =>
      messages.reduce(
        (acc, m) => {
          if (m.role !== "assistant" || !m.outputTokens) return acc;
          return {
            inputTokens: acc.inputTokens + (m.inputTokens ?? 0),
            outputTokens: acc.outputTokens + m.outputTokens,
            costUsd: acc.costUsd + (m.costUsd ?? 0),
            turns: acc.turns + 1,
          };
        },
        { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 },
      ),
    [messages],
  );

  const lastAssistantId =
    [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  return (
    <MessageScrollerProvider
      // Following the stream is the expected behaviour on a live turn, and
      // it releases the moment the reader scrolls away.
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={64}
      scrollMargin={24}
    >
      <div className="relative flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-hidden bg-background">
        {temporary ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground"
          >
            <Pin className="size-3 rotate-45" aria-hidden />
            Temporary chat — not saved to your history, not remembered, and cannot be shared.
          </div>
        ) : null}

        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent busy={streaming}>
              {empty ? (
                // A screen-relative floor, not `100dvh - 26rem`. That
                // subtraction assumed header + suggestions + composer come
                // to 26rem, so on a short phone it overflowed and pushed the
                // composer past the fold. `svh` is the one that cannot
                // overshoot: it is the height with browser chrome showing.
                <div className="flex min-h-[55svh] flex-col justify-center">
                  <h1 className="text-3xl font-semibold tracking-tight text-balance">
                    {hasPlan ? "What are you working on?" : "Welcome to Zaino AI"}
                  </h1>
                  <p className="mt-2 max-w-[54ch] text-base leading-relaxed text-muted-foreground">
                    {hasPlan ? (
                      <>
                        You are on{" "}
                        <span className="font-medium text-foreground">
                          {alias ? aliasMeta(alias).label : "your plan's model"}
                        </span>
                        . Ask anything, paste an error, or pick a starting point below.
                      </>
                    ) : (
                      "Your account is ready and the chat is live. Your first message will ask you to choose a plan — nothing is charged until you do."
                    )}
                  </p>
                </div>
              ) : (
                messages.map((m, i) => (
                  <MessageScrollerItem
                    key={m.id}
                    messageId={m.id}
                    // The person's turn is the anchor: each question settles
                    // near the top and its answer streams into the room
                    // below, so the reader starts at the first line instead
                    // of chasing the bottom.
                    scrollAnchor={m.role === "user"}
                  >
                    <Turn
                      message={m}
                      streaming={streaming && m.id === lastAssistantId}
                      canRegenerate={
                        !streaming && m.id === lastAssistantId && m.content.length > 0
                      }
                      onRegenerate={() => void send(lastSent.current ?? "", { regenerate: true })}
                      // Only the person's turns rewind, only while nothing is
                      // in flight, and only when there is something after
                      // them to hide — reverting the newest turn would be a
                      // no-op that still cleared the composer.
                      onRevert={
                        !streaming &&
                        m.role === "user" &&
                        i < messages.length - 1 &&
                        !temporary
                          ? () =>
                              setRevertTarget({
                                messageId: m.id,
                                content: m.content,
                                hides: messages.length - i,
                              })
                          : undefined
                      }
                    />
                  </MessageScrollerItem>
                ))
              )}

              {failure ? (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-4 sm:flex-row sm:items-start"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-foreground">{failure.message}</p>
                    {failure.paywall ? (
                      <Button
                        className="mt-3"
                        size="sm"
                        nativeButton={false}
                        render={<Link href="/settings?tab=plan" />}
                      >
                        See plans
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>

        <div className="grid shrink-0 gap-4 pt-4">
          {/* The suggestion row is for a conversation that has not started.
              Showing it mid-thread competes with the composer and pushes the
              input down the page for no gain. */}
          {empty ? <Suggestion suggestions={SUGGESTIONS} onPick={(t) => setDraft(t)} /> : null}

          {/* The revert receipt. Above the composer rather than in a toast
              (bottom-right is where the send button is), and dismissible so
              it never becomes permanent furniture. */}
          {undoOffer ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground"
            >
              <Undo2 className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                Reverted {undoOffer.hides} {undoOffer.hides === 1 ? "message" : "messages"}. Your
                text is back in the composer — edit it and send again.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void undoRevert(undoOffer.batchId)}
                className="shrink-0 px-1.5 py-1 font-medium"
              >
                Undo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setUndoOffer(null)}
                aria-label="Dismiss"
                className="shrink-0 p-1"
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          ) : null}

          <PromptInput
            onSend={send}
            onStop={() => abortRef.current?.abort()}
            onAttach={upload}
            streaming={streaming}
            draft={draft}
            onDraftChange={setDraft}
            placeholder={
              hasPlan
                ? "What would you like to know?"
                : "Ask anything — you will be asked to pick a plan first"
            }
            busy={uploading}
            attach={
              <AttachControl
                onAdd={upload}
                disabled={streaming}
                // Error chips are not real attachments, so they must not
                // occupy a slot against the cap.
                count={chips.filter((c) => c.status !== "error").length}
                max={MAX_ATTACHMENTS}
              />
            }
            attachments={
              chips.length > 0 ? (
                <AttachmentRow
                  chips={chips}
                  onRemove={(localId) =>
                    setChips((prev) => prev.filter((c) => c.localId !== localId))
                  }
                />
              ) : null
            }
            tools={
              <>
                {searchAvailable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setWebSearch((on) => !on)}
                    aria-pressed={webSearch}
                    title={
                      webSearch ? "Searching the web for this chat" : "Search the web for this chat"
                    }
                    className={cn(
                      "shrink-0 gap-1 rounded-full px-2.5 text-[11px] font-medium sm:px-2",
                      webSearch
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Globe className="size-3" aria-hidden />
                    Search
                  </Button>
                )}
                {/* Only offered once search is on: a deep search with nothing
                    to search is a switch that does nothing. */}
                {searchAvailable && webSearch && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setDeepSearch((on) => !on)}
                    aria-pressed={deepSearch}
                    title={
                      deepSearch
                        ? "Reading the pages found, not just their summaries"
                        : "Read the pages found, not just their summaries"
                    }
                    className={cn(
                      "shrink-0 gap-1 rounded-full px-2.5 text-[11px] font-medium sm:px-2",
                      deepSearch
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <BookOpen className="size-3" aria-hidden />
                    Deep
                  </Button>
                )}
                <ModelPicker
                  options={options}
                  value={alias}
                  onChange={setAlias}
                  disabled={streaming}
                />
                {/* The reset time lives in the meter's tooltip rather than as
                    its own "· resets 5 Nov, 00:00" string: it is the second
                    half of one fact, and as a separate line it was the widest
                    item in the footer. */}
                <QuotaHint
                  option={options.find((o) => o.alias === (alias ?? options[0]?.alias))}
                  className="hidden sm:flex"
                  resetsAt={resetsAt}
                  usage={usage}
                />
              </>
            }
          />
        </div>

        {/* Confirmation, because the visible effect is a chunk of the
            conversation disappearing. It states the COUNT rather than a
            vague "later messages": the person is about to lose an answer
            they may still be reading, and "3 messages" is what makes them
            check first. `destructive` is deliberately absent — nothing is
            deleted, and the toast's Undo puts it straight back. */}
        <Dialog
          open={revertTarget !== null}
          onOpenChange={(open) => {
            if (!open && !reverting) setRevertTarget(null);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Revert to this message?</DialogTitle>
              <DialogDescription>
                {revertTarget
                  ? `${revertTarget.hides} ${revertTarget.hides === 1 ? "message" : "messages"} — this one and everything after it — will be hidden from the chat. Your text goes back into the composer so you can change it. You can undo this.`
                  : null}
              </DialogDescription>
            </DialogHeader>
            {revertTarget ? (
              <p className="line-clamp-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
                {revertTarget.content}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRevertTarget(null)}
                disabled={reverting}
              >
                Cancel
              </Button>
              <Button onClick={() => void applyRevert()} disabled={reverting}>
                {reverting ? "Reverting…" : "Revert"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MessageScrollerProvider>
  );
}

/** Starter prompts. Fill the composer; they do not send. */
const SUGGESTIONS = [
  "Explain this codebase to me",
  "Help me debug a failure",
  "Review my last change for bugs",
  "Plan how to implement a feature",
  "What are the trade-offs of this design?",
  "Write tests for this function",
];

/**
 * Turn — one message, in the shape its role calls for.
 *
 * The user's turn is a filled Bubble, right-aligned, with its attachments
 * underneath so the message stays the primary object. The assistant's turn
 * is unbubbled markdown with a Sources panel above and actions below.
 */
function Turn({
  message,
  streaming,
  onRegenerate,
  canRegenerate,
  onRevert,
}: {
  message: ChatMessage;
  streaming: boolean;
  onRegenerate: () => void;
  canRegenerate: boolean;
  /** Absent when this turn cannot be rewound to — see the caller. */
  onRevert?: () => void;
}) {
  if (message.role === "user") {
    return (
      <Message align="end">
        {/* `w-full` is load-bearing, not tidying. `Message` is
            `items-end`, so a shrink-to-fit content box made the Bubble's
            `max-w-[95%]` resolve against its own max-content width — a
            circular basis. The visible result was a one-word message
            ("hey") wrapping its last letter onto a second line, and an
            unbreakable URL sizing the bubble to 778px inside a 736px
            column. */}
        <MessageContent className="flex w-full flex-col items-end gap-1.5">
          <Bubble variant="muted">
            <BubbleContent>{message.content}</BubbleContent>
          </Bubble>
          {message.attachments && message.attachments.length > 0 && (
            <ul
              className="flex max-w-[95%] flex-wrap justify-end gap-1.5"
              aria-label="Attached files"
            >
              {message.attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  <span className="max-w-[180px] truncate">{file.filename}</span>
                  {file.chars !== undefined && file.chars > 0 ? (
                    <span className="tabular-nums opacity-70">{formatChars(file.chars)}</span>
                  ) : (
                    <span className="opacity-70">{guessKind(file.kind ?? file.filename)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* The rewind lives on the PERSON'S turn, not on the answer.
              "Revert to here" means "this question was the wrong one", so
              the control belongs where the question is — and it keeps the
              answer's toolbar (Copy, Regenerate, cost) meaning exactly what
              it says. */}
          {onRevert ? (
            <MessageActions className="justify-end">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onRevert}
                className="gap-1 px-1.5"
              >
                <Undo2 className="size-3" aria-hidden />
                Revert to here
              </Button>
            </MessageActions>
          ) : null}
        </MessageContent>
      </Message>
    );
  }

  // The thinking detail lives while the stream is open and the answer
  // has not started — INCLUDING when the model is reasoning (heavy
  // tasks stream deliberation first). Hiding it once reasoning arrived
  // is exactly the "no indicator" bug: the orb + shimmer + elapsed
  // seconds must stay up until the first answer token lands.
  const thinking = streaming && message.content === "";
  // Truncation is its own state: the model hit the ceiling rather than
  // choosing to stop. Reporting both as "Stopped" would tell the user to
  // scroll when there is nothing below.
  const truncated = message.finishReason === "length";
  const cut = message.finish === "aborted" || message.finish === "error";

  return (
    <Message align="start">
      <MessageContent>
        {/* ONE SPACING AUTHORITY for the answer's stacked blocks.
            Sources and Reasoning carry `mb-4` of their own (they are used
            standalone elsewhere), so spacing them here as well produced
            16px in one gap and 0px in the next — the Sources pill sat flush
            under the thinking skeleton. A gap column plus `mb-0` at the call
            site gives every block the same rhythm instead of whichever
            component happened to have a margin. */}
        <div className="flex flex-col gap-4">
        {thinking ? (
          <Loader label="Thinking" />
        ) : null}
        <>
            {message.sources && message.sources.length > 0 ? (
              <Sources sources={message.sources} className="mb-0" />
            ) : null}

            {message.reasoning ? (
              <Reasoning text={message.reasoning} live={streaming} className="mb-0" />
            ) : null}

            {message.content ? (
              // Markdown, not `dangerouslySetInnerHTML`. Streamdown is built
              // for half-arrived markdown (an unterminated fence does not
              // flash as text) and hardens HTML, so raw model output is
              // dropped rather than injected. `Markdown` also supplies the
              // plugins core does not bundle — KaTeX for maths, mermaid for
              // diagrams — and themes a diagram to match the app.
              <Markdown streaming={streaming}>{message.content}</Markdown>
            ) : null}

            {truncated && !streaming ? (
              <p className="text-[11px] text-warning text-warning">
                This answer hit the length limit and was cut off. Ask it to continue.
              </p>
            ) : null}
          </>
        </div>

        <MessageActions>
          {cut ? (
            <span>{message.finish === "aborted" ? "Stopped" : "Interrupted"}</span>
          ) : null}
          {message.outputTokens ? (
            <span className="tabular">
              {message.inputTokens ?? 0} in · {message.outputTokens} out
            </span>
          ) : null}
          {typeof message.costUsd === "number" && message.costUsd > 0 ? (
            <span className="tabular">{formatUsd(message.costUsd)}</span>
          ) : null}
          {message.content && !streaming ? (
            <>
              <CopyButton text={message.content} />
              {/* Rendered only on the latest turn and only when it can act.
                  A disabled Regenerate on every message is a column of dead
                  buttons that says the feature is broken. */}
              {canRegenerate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onRegenerate}
                  className="gap-1 px-1.5"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Regenerate
                </Button>
              ) : null}
            </>
          ) : null}
        </MessageActions>
      </MessageContent>
    </Message>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
      }}
      className="gap-1 px-1.5"
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function formatUsd(value: number): string {
  if (value < 0.01) return `${(value * 100).toFixed(2)}¢`;
  return `$${value.toFixed(2)}`;
}
