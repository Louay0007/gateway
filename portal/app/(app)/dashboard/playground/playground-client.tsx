"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PromptBar from "@/components/ui/prompt-bar";
import { ChatContainer } from "@/components/ui/chat-container";
import { ChatMessage, WelcomeMessage } from "@/components/ui/chat-message";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Alias = "fast" | "smart" | "frontier";

const ALIASES: { value: Alias; label: string; color: string }[] = [
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
  const [alias, setAlias] = useState<Alias>("fast");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const active = ALIASES.find((a) => a.value === alias)!;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isStreaming) scrollToBottom();
  }, [isStreaming, scrollToBottom]);

  const handleSubmit = async (content: string) => {
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
              // Unparseable fragment (a frame the server skipped over too,
              // or a partial the delimiter missed). Skipped, not fatal.
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
              if (parsed.usage) {
                setSessionTokens((t) => ({
                  input: t.input + (parsed.usage!.prompt_tokens || 0),
                  output: t.output + (parsed.usage!.completion_tokens || 0),
                }));
              }
              if (parsed.costUsd != null) {
                setSessionCost((c) => c + parsed.costUsd!);
              }
              setIsStreaming(false);
            }
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message."
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
    } finally {
      setIsStreaming(false);
    }
  };

  const clearChat = () => {
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
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Model</span>
              {/* Aliases only. The upstream model behind an alias is never
                  customer-facing — rendering it teaches customers a name we
                  are free to swap tomorrow. */}
              <Select
                value={alias}
                onValueChange={(v) => setAlias(v as Alias)}
                disabled={isStreaming}
              >
                <SelectTrigger className="w-full">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: active.color }}
                  />
                  <SelectValue>{active.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ALIASES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      <span
                        className="w-2 h-2 rounded-full inline-block mr-2"
                        style={{ backgroundColor: a.color }}
                      />
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          className="mx-auto"
        />
      </div>
    </div>
  );
}
