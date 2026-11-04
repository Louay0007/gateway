/**
 * DELETE and PATCH for one conversation.
 *
 * Both answer 404 for "no such row" and "not yours" alike — the store's
 * predicates include org AND user, so a wrong id and someone else's id are
 * the same non-event. That is the IDOR rule and it is
 * why neither route takes an org or user id from the caller.
 */

import { z } from 'zod';

import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import {
  archiveConversation,
  renameConversation,
  setPinned,
  updateConversationSettings,
} from '@/lib/chat/service';
import { GenerationSettings } from '@/lib/chat/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();
/**
 * Every mutable field is optional, and at least one must be present. A
 * single PATCH shape beats three routes for three fields: the UI toggles a
 * pin and renames from the same menu, and a second endpoint would be a
 * second place to forget the org filter.
 */
const Patch = z
  .object({
    title: z.string().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    settings: GenerationSettings.partial().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined || v.settings !== undefined, {
    message: 'Nothing to change.',
  });

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    // A malformed id is a 404, not a 400: "bad uuid" and "no such row" must
    // be indistinguishable or the error code becomes an oracle.
    if (!uuid.safeParse(id).success) return jsonError('not_found', 'Conversation not found.');

    const ctx = await requireActiveOrg();
    const removed = await archiveConversation({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
    });
    if (!removed) return jsonError('not_found', 'Conversation not found.');

    return Response.json({ archived: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return jsonError('not_found', 'Conversation not found.');

    let body: z.infer<typeof Patch>;
    try {
      body = Patch.parse(await request.json());
    } catch {
      return jsonError('validation', 'Nothing to change.');
    }

    const ctx = await requireActiveOrg();
    const result: { title?: string; pinnedAt?: string | null; settings?: boolean } = {};

    if (body.title !== undefined) {
      const renamed = await renameConversation({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        conversationId: id,
        title: body.title,
      });
      if (!renamed) return jsonError('not_found', 'Conversation not found.');
      result.title = renamed.title;
    }

    if (body.pinned !== undefined) {
      const pinned = await setPinned({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        conversationId: id,
        pinned: body.pinned,
      });
      if (!pinned) return jsonError('not_found', 'Conversation not found.');
      result.pinnedAt = pinned.pinnedAt;
    }

    if (body.settings !== undefined) {
      const ok = await updateConversationSettings({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        conversationId: id,
        settings: body.settings,
      });
      if (!ok) return jsonError('not_found', 'Conversation not found.');
      result.settings = true;
    }

    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
