export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  model?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

interface ChatMessageProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const metaParts: string[] = [];
  if (message.model) metaParts.push(message.model);
  if (message.tokens) {
    metaParts.push(
      `${message.tokens.input.toLocaleString()}in / ${message.tokens.output.toLocaleString()}out`
    );
  }
  if (message.costUsd != null) {
    metaParts.push(`$${message.costUsd.toFixed(4)}`);
  }

  return (
    <div className="flex w-full flex-col gap-1">
      <div
        className={
          "flex max-w-[88%] items-end gap-2 px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm border" +
          (isUser
            ? " justify-end bg-primary text-primary-foreground rounded-tr-none border-transparent"
            : " justify-start bg-card text-card-foreground rounded-tl-none border-border")
        }
      >
        {isUser ? (
          <>
            <span>{message.content}</span>
            <span className="text-[10px] opacity-60 mt-1 block text-right">{time}</span>
          </>
        ) : (
          <>
            <span className={isStreaming ? "animate-pulse" : ""}>
              {message.content}
            </span>
            {isStreaming && <span className="font-mono">▌</span>}
          </>
        )}
      </div>

      {isAssistant && metaParts.length > 0 && (
        <div className="flex w-full justify-end px-4 pb-1">
          <span className="text-[10px] text-muted-foreground">
            {metaParts.join("  •  ")} · {time}
          </span>
        </div>
      )}
    </div>
  );
}

export function WelcomeMessage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">New conversation</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Ask anything. Your conversation runs through your selected model on the
        Zaino gateway — every token counts against your plan budget.
      </p>
    </div>
  );
}