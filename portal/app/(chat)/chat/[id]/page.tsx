import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatView } from "@/components/chat/chat-view";
import { getConversation, listMessages } from "@/lib/chat/service";
import { loadChatScreen, toChatMessages } from "@/lib/chat/screen";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

/**
 * /chat/[id] — an existing conversation.
 *
 * Ownership is checked by `getConversation`, whose predicate includes org
 * AND user, and `listMessages` is called only after it returns a row. That
 * ordering is the whole guard: listing first and filtering afterwards is
 * how a page ships that shows one customer's transcript to another.
 *
 * A conversation that is missing, archived, or someone else's is the same
 * `notFound()` — the id is not an oracle.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const screen = await loadChatScreen();

  const conversation = await getConversation({
    organizationId: screen.orgId,
    userId: screen.userId,
    conversationId: id,
  });
  if (!conversation) notFound();

  const history = toChatMessages(await listMessages(conversation.id));

  return (
    <ChatView
      options={screen.options}
      allowed={screen.allowed}
      resetsAt={screen.resetsAt}
      hasPlan={screen.hasPlan}
      searchAvailable={screen.searchAvailable}
      temporary={conversation?.temporary ?? false}
      title={conversation.title}
      conversationId={conversation.id}
      initialMessages={history}
    />
  );
}
