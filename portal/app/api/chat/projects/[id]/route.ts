/**
 * PATCH / DELETE /api/chat/projects/[id]
 *
 * PATCH  rename, rewrite instructions, recolour
 * DELETE archive — never a hard delete. A hard delete would silently
 *        unparent every chat inside it (`ON DELETE SET NULL`), and the user
 *        would experience that as "my conversations moved" with no undo.
 *
 * The body is parsed with `.partial()` on purpose: the UI sends only what
 * changed, and a full-object PATCH would let a stale tab overwrite a
 * colleague's rename. Undefined means "leave it alone", which the service
 * expresses as COALESCE against the existing value.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { archiveProject, updateProject } from '@/lib/chat/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Patch = z
  .object({
    name: z.string().trim().min(1).max(80),
    instructions: z.string().max(8000),
    color: z.string().max(20),
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
    if (!UUID.test(id)) return jsonError('not_found', 'That project does not exist.');

    let body: z.infer<typeof Patch>;
    try {
      body = Patch.parse(await request.json());
    } catch {
      return jsonError('validation', 'Those changes could not be read.');
    }

    const project = await updateProject({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      projectId: id,
      name: body.name,
      instructions: body.instructions,
      color: body.color,
    });
    if (!project) return jsonError('not_found', 'That project does not exist.');

    return Response.json({ project });
  } catch (e) {
    if (e instanceof Error && e.message.includes('already have a project')) {
      return jsonError('conflict', e.message);
    }
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
    if (!UUID.test(id)) return jsonError('not_found', 'That project does not exist.');

    const archived = await archiveProject({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      projectId: id,
    });
    if (!archived) return jsonError('not_found', 'That project does not exist.');

    // The chats are NOT deleted; they are unparented by the archive and
    // reappear at the top level of the sidebar.
    return Response.json({ archived: true });
  } catch (e) {
    return errorResponse(e);
  }
}
