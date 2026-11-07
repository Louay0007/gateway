/**
 * GET / POST / DELETE /api/chat/conversations/[id]/share (audit #11).
 *
 * POST creates a link and returns it ONCE. The raw token is never stored
 * (lib/chat/share.ts keeps a sha256), so this response is the only time the
 * URL exists — the UI must show it immediately and not promise to retrieve
 * it later.
 *
 * DELETE revokes. It takes `?shareId=` rather than revoking "the" share,
 * because a conversation can legitimately have had several over time and
 * revoking the wrong one would leave the wrong link live.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import {
  clampShareDays,
  createShare,
  listShares,
  MAX_SHARE_DAYS,
  revokeShare,
} from '@/lib/chat/share';
import { getConversation } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Create = z.object({
  throughMessageId: z.string().uuid().nullish(),
  expiresInDays: z.number().int().min(1).max(MAX_SHARE_DAYS).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That conversation does not exist.');

    // Org-scoping alone is not enough: a colleague in the same org must not
    // be able to enumerate (or learn the view counts of) another person's
    // share links. Ownership is the same predicate the chat page uses.
    const owned = await getConversation({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
    });
    if (!owned) return jsonError('not_found', 'That conversation does not exist.');

    const shares = await listShares({ organizationId: ctx.orgId, conversationId: id });
    return Response.json({ shares }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That conversation does not exist.');

    // Ownership, and the temporary-chat rule, are enforced here rather than
    // trusted from the client: a temporary chat is never shareable, because
    // the user asked for it not to be saved anywhere.
    const owned = await getConversation({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
    });
    if (!owned) return jsonError('not_found', 'That conversation does not exist.');
    if (owned.temporary) {
      return jsonError('validation', 'A temporary chat cannot be shared.');
    }

    let body: z.infer<typeof Create> = {};
    try {
      body = Create.parse(await request.json().catch(() => ({})));
    } catch {
      return jsonError('validation', 'Those share settings could not be read.');
    }

    const days = clampShareDays(body.expiresInDays);
    const created = await createShare({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
      throughMessageId: body.throughMessageId ?? null,
      expiresInDays: days,
    });
    if (!created) {
      return jsonError('validation', 'That message is not part of this conversation.');
    }

    return Response.json(
      {
        share: created.share,
        // Returned once. The client must show it now; there is no endpoint
        // that can produce it again, by design.
        url: `/share/${created.token}`,
        expiresInDays: days,
      },
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    // The conversation id in the URL is a real predicate, not decoration: a
    // share of chat A cannot be revoked through chat B's path.
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That conversation does not exist.');

    const shareId = new URL(request.url).searchParams.get('shareId');
    if (!shareId || !UUID.test(shareId)) return jsonError('validation', 'Unknown share.');

    const revoked = await revokeShare({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
      shareId,
    });
    if (!revoked) return jsonError('not_found', 'That link is already gone.');

    return Response.json({ revoked: true });
  } catch (e) {
    return errorResponse(e);
  }
}
