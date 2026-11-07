/**
 * POST   rewind a conversation to one user turn
 * DELETE undo the most recent rewind (by its batch id)
 *
 * Same shape as the sibling `route.ts`: a malformed id is a 404, never a
 * 400, because "bad uuid" and "not yours" have to be indistinguishable or
 * the status code becomes an oracle. Neither verb takes an org or user id
 * from the caller — the store's predicate derives both from the session.
 *
 * WHY ONE FILE FOR BOTH. They are the two halves of one user action (revert,
 * then take-it-back), they share the ownership rule, and a second file would
 * be a second place to forget it.
 */

import { z } from 'zod';

import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { revertToMessage, undoRevert } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return jsonError('not_found', 'Conversation not found.');

    let messageId: string;
    try {
      messageId = z.object({ messageId: z.string().uuid() }).parse(await request.json()).messageId;
    } catch {
      return jsonError('validation', 'A message id is required.');
    }

    const ctx = await requireActiveOrg();
    const reverted = await revertToMessage({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
      messageId,
    });
    // Also the answer when the target is an assistant row: reverting to an
    // answer is regen, which has its own path, so it is "not a thing here"
    // rather than a second way to do it.
    if (!reverted) return jsonError('not_found', 'Message not found.');

    return Response.json(reverted);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return jsonError('not_found', 'Conversation not found.');

    const batchId = new URL(request.url).searchParams.get('batchId') ?? '';
    if (!uuid.safeParse(batchId).success) return jsonError('validation', 'Unknown revert.');

    const ctx = await requireActiveOrg();
    const undone = await undoRevert({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
      batchId,
    });
    if (!undone) return jsonError('not_found', 'Conversation not found.');

    return Response.json(undone);
  } catch (e) {
    return errorResponse(e);
  }
}
