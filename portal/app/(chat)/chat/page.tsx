import type { Metadata } from "next";

import { ChatView } from "@/components/chat/chat-view";
import { loadChatScreen } from "@/lib/chat/screen";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

/**
 * /chat — a new conversation.
 *
 * The screen's data comes from `loadChatScreen`, the same call
 * `/chat/[id]` makes, so the two pages cannot disagree about which aliases
 * the wall permits right now. The shape of the two lists is the design:
 *
 *   options = every alias the PLAN entitles (spent ones included), so an
 *             exhausted tier can say "out of tokens this period" instead
 *             of vanishing, which reads as a bug.
 *   allowed = the subset the token wall still permits — what the composer
 *             may actually send.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ temporary?: string; project?: string }>;
}) {
  const screen = await loadChatScreen();
  const { temporary, project } = await searchParams;
  return (
    <ChatView
      options={screen.options}
      allowed={screen.allowed}
      resetsAt={screen.resetsAt}
      hasPlan={screen.hasPlan}
      searchAvailable={screen.searchAvailable}
      // A temporary chat is created by the first send, not by this page:
      // `?temporary=1` is a mode for the composer, and the server reads the
      // same flag on the turn that actually creates the row.
      temporary={temporary === "1"}
      // The project the first send files the new chat under. Sent with that
      // turn because the row does not exist yet — the server creates it with
      // the project already set, so its instructions apply from turn one.
      projectId={project ?? null}
    />
  );
}
