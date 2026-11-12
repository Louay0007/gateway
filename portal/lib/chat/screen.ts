/**
 * The server-side half of the chat screen, shared by `/chat` and
 * `/chat/[id]`.
 *
 * Both pages need exactly the same three things before they can render a
 * composer: who is signed in, which org, and what the quota wall permits.
 * Written twice they would drift, and the drift would be invisible —
 * `/chat/[id]` would offer an alias the wall had already closed, and the
 * only symptom would be a 403 after the user typed a paragraph.
 */

import { redirect } from 'next/navigation';

import type { ChatMessage } from '@/components/chat/chat-view';
import type { ModelOption } from '@/components/chat/model-picker';
import { ALIAS_ORDER } from '@/components/chat/aliases';
import { currentUser, listMemberships } from '@/lib/auth/authorize';
import { ensureSessionReady } from '@/lib/auth/provision';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
import { tokenPoolFromLimits, tokensUsedInWindow } from '@/lib/entitlements/quota';
import { webSearchConfigured } from '@/lib/chat/web-search';

export interface ChatScreen {
  options: ModelOption[];
  allowed: string[];
  resetsAt: string | null;
  hasPlan: boolean;
  /** Whether the deploy has a search backend; drives the composer toggle. */
  searchAvailable: boolean;
  orgId: string;
  userId: string;
}

/**
 * Redirects rather than throwing, like the page it replaces: an anonymous
 * request has no error worth showing, it has a sign-in page.
 */
export async function loadChatScreen(): Promise<ChatScreen> {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  // The layout runs this too; `cache()` scopes it to one execution per
  // request, and the layout and page render CONCURRENTLY, so provisioning
  // in the layout alone lets this page read memberships before the
  // transaction commits (lib/auth/provision.ts states the race).
  await ensureSessionReady(user.id);

  const memberships = await listMemberships();
  const orgId = memberships[0]?.orgId;
  if (!orgId) redirect('/sign-in');

  const wall = await getAllowedModels(orgId);

  // Plan order first, then anything else the plan entitles. A plan may name
  // aliases this build has no copy for; they still render under their own
  // name (`aliasMeta`) and never under an upstream model name.
  const entitled = [...new Set(wall.entitled)].sort((a, b) => rank(a) - rank(b));

  // 0039: ONE POOL. Every option carries the plan's shared allowance and
  // what is left of it, because that is the only budget that exists. A
  // per-alias `limit - used` would grey out a model the customer can still
  // afford while leaving another enabled that they cannot use either — the
  // exact confusion the pool removes.
  const pool = tokenPoolFromLimits(wall.tokenLimits);
  const remaining = pool === null ? undefined : Math.max(0, pool - tokensUsedInWindow(wall.usedTokensBy));
  const options: ModelOption[] = entitled.map((alias) => ({
    alias,
    tokenLimit: pool ?? undefined,
    remainingTokens: remaining,
  }));

  return {
    options,
    allowed: wall.allowed,
    resetsAt: formatWindowEnd(wall.period?.end ?? null),
    hasPlan: wall.entitled.length > 0,
    // A deployment with no search backend hides the control entirely rather
    // than showing a button that can never succeed.
    searchAvailable: webSearchConfigured(),
    orgId,
    userId: user.id,
  };
}

/**
 * A stored transcript, as the view renders it.
 *
 * Only user and assistant turns are passed: a `system` row (there are none
 * today) would render as an assistant bubble with no attribution. A turn
 * that was cut short keeps its status so the UI can say so instead of
 * pretending the sentence ended there.
 */
export function toChatMessages(
  rows: {
    id: string;
    role: string;
    content: string;
    status: string;
    reasoning?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
    latencyMs?: number | null;
    finishReason?: string | null;
    sources?: { title: string; url: string; snippet: string }[];
    attachments?: { id: string; filename: string; kind: string; chars: number }[];
  }[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    // `streaming`/`pending` can only be read back when the process died
    // mid-turn: no request is open by the time a page renders. Rendering
    // them as live would recreate a spinner that never stops, so the only
    // honest reading is "interrupted".
    const finish =
      r.status === 'error' ? 'error' : r.status === 'complete' ? undefined : 'aborted';
    out.push({
      id: r.id,
      role: r.role,
      content: r.content,
      // A reopened conversation shows the same deliberation and the same
      // per-turn numbers as the live one. Reading them back is what makes
      // 0027's `reasoning` and the typed token columns worth storing.
      reasoning: r.reasoning ?? undefined,
      finish,
      // The server's own reason, so a reloaded answer cut at the token
      // ceiling still says so. Without this the transcript renders a
      // truncated reply exactly like a finished one.
      finishReason: r.finishReason ?? undefined,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      costUsd: r.costUsd ?? null,
      latencyMs: r.latencyMs ?? null,
      // Both of these were written on the live turn and dropped here, which
      // is why files and citations disappeared on reload.
      sources: r.sources && r.sources.length > 0 ? r.sources : undefined,
      attachments:
        r.attachments && r.attachments.length > 0
          ? r.attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              kind: a.kind,
              chars: a.chars,
            }))
          : undefined,
    });
  }
  return out;
}

function rank(alias: string): number {
  const i = ALIAS_ORDER.indexOf(alias as (typeof ALIAS_ORDER)[number]);
  return i === -1 ? ALIAS_ORDER.length : i;
}

/**
 * The window end, in the customer's words.
 *
 * `wall.period` is already correct for BOTH clock models — the billing
 * period for every row since 0038 (`subscriptions.daily_quota` is FALSE), a
 * Tunis day for the one-off row an operator leaves on a daily quota. So this
 * formats whatever it was given and NEVER invents "today": the two-clock
 * trap is precisely labelling a monthly window as a daily one.
 */
function formatWindowEnd(end: Date | null): string | null {
  if (!end) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Tunis',
  }).format(end);
}
