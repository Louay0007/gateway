"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PromptBar, { type BarModel } from "@/components/ui/prompt-bar";
import { ChatContainer } from "@/components/ui/chat-container";
import { ChatMessage, WelcomeMessage } from "@/components/ui/chat-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ALIASES: BarModel[] = [
  { value: "fast", label: "Fast", color: "#4fd1a5" },
  { value: "smart", label: "Smart", color: "#6aa8ff" },
  { value: "frontier", label: "Frontier", color: "#c792ea" },
];

export function Playground() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
  const [error, setError] = useState<string | null>(null);
  const [alias, setAlias] = useState("fast");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const active = ALIASES.find((a) => a.value === alias) ?? ALIASES[0]!;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isStreaming) scrollToBottom();
  }, [isStreaming, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSubmit = async (content: string) => {
    if (isStreaming) return;
    setError(null);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model: alias,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: alias,
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Chat failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantContent = "";
      // Same rule as the server: frames split on the `\n\n` SSE delimiter,
      // never per TCP chunk. Splitting chunks on bare newlines drops tokens
      // whenever a frame boundary lands mid-chunk.
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            let parsed: {
              delta?: { content?: string };
              done?: boolean;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              costUsd?: number;
              error?: string;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              // Unparseable fragment. Skipped, not fatal.
              continue;
            }
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta?.content) {
              assistantContent += parsed.delta.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            }
            if (parsed.done) {
              const usage = parsed.usage
                ? {
                    input: parsed.usage.prompt_tokens || 0,
                    output: parsed.usage.completion_tokens || 0,
                  }
                : undefined;
              if (usage) {
                setSessionTokens((t) => ({
                  input: t.input + usage.input,
                  output: t.output + usage.output,
                }));
              }
              if (parsed.costUsd != null) {
                setSessionCost((c) => c + (parsed.costUsd ?? 0));
              }
              // Stamp the turn itself so the message meta row shows what
              // this answer cost — not just the session totals above.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, tokens: usage, costUsd: parsed.costUsd }
                    : m
                )
              );
              setIsStreaming(false);
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // User pressed Stop: the partial answer stays, no error shown.
        // The server meters whatever tokens it counted before the abort.
        setIsStreaming(false);
        return;
      }
      setError(
        err instanceof Error ? err.message : "Failed to send message."
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const clearChat = () => {
    if (isStreaming) abortRef.current?.abort();
    setMessages([]);
    setSessionCost(0);
    setSessionTokens({ input: 0, output: 0 });
    setError(null);
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Playground</h2>
            <p className="text-sm text-muted-foreground">
              Test your models with real gateway traffic. Every token counts
              against your plan budget.
            </p>
          </div>
          <Button onClick={clearChat} size="sm" variant="outline">
            New chat
          </Button>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Session</CardTitle>
          </CardHeader>
          {/*
            The model badge is READ-ONLY on purpose. The picker lives in the
            prompt bar below — two pickers for one value is how the bar said
            "Équilibré" while this card said "Fast". One control, one truth.
          */}
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Model</span>
              <span className="flex items-center gap-2 rounded-lg border border-input bg-muted px-2.5 py-2 text-sm text-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: active.color }}
                  aria-hidden="true"
                />
                {active.label}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tokens (in / out)</span>
              <span className="text-sm font-mono text-foreground">
                {sessionTokens.input.toLocaleString()} /{" "}
                {sessionTokens.output.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Est. cost</span>
              <span className="text-sm font-mono text-foreground">
                ${sessionCost.toFixed(4)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Messages</span>
              <span className="text-sm font-mono text-foreground">
                {messages.filter((m) => m.role === "user").length}
              </span>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/50 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-[400px] flex flex-col gap-0">
          <ChatContainer autoScroll={isStreaming || messages.length === 0}>
            {!hasMessages && !isStreaming ? (
              <WelcomeMessage />
            ) : (
              messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    isStreaming && msg.role === "assistant" && !msg.content.endsWith("▌")
                  }
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </ChatContainer>
        </div>

        <PromptBar
          placeholder={hasMessages ? "Type a message…" : "Say hello to your model"}
          onSubmit={handleSubmit}
          streaming={isStreaming}
          onStop={handleStop}
          model={alias}
          models={ALIASES}
          onModelChange={setAlias}
          className="mx-auto"
        />
      </div>
    </div>
  );
}
