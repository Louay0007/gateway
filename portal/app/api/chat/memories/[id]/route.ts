/**
 * PATCH / DELETE /api/chat/memories/[id] — one fact.
 *
 * The viewer's whole point is that a user can point at ONE thing and remove
 * it, so delete here is a HARD delete (lib/chat/memory.ts explains why a
 * soft delete would not honour "forget this").
 *
 * PATCH covers pin and reword. Both fields are optional: the UI pins with a
 * toggle and rewrites with a text field, and neither send should have to
 * echo the other.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { forgetMemory, updateMemory } from '@/lib/chat/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Patch = z
  .object({
    content: z.string().trim().min(1).max(500),
    category: z.string().max(40),
    pinned: z.boolean(),
  })
  .partial();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That memory does not exist.');

    let body: z.infer<typeof Patch>;
    try {
      body = Patch.parse(await request.json());
    } catch {
      return jsonError('validation', 'That change could not be read.');
    }

    const memory = await updateMemory({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      memoryId: id,
      content: body.content,
      category: body.category,
      pinned: body.pinned,
    });
    if (!memory) return jsonError('not_found', 'That memory does not exist.');

    return Response.json({ memory });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That memory does not exist.');

    const removed = await forgetMemory({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      memoryId: id,
    });
    if (!removed) return jsonError('not_found', 'That memory does not exist.');

    return Response.json({ removed: true });
  } catch (e) {
    return errorResponse(e);
  }
}
