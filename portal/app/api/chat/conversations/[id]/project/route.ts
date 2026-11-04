/**
 * PUT /api/chat/conversations/[id]/project — move a chat in or out (0031).
 *
 * A separate route from PATCH .../conversations/[id] because moving is not
 * a setting: it changes which INSTRUCTIONS apply to every future turn in the
 * chat, so it deserves its own endpoint and its own ownership check on both
 * sides (the chat, and the destination project).
 *
 * `{ projectId: null }` removes it. The service returns false when the
 * project is not the caller's, which is the same answer as a bad id — a
 * project id is not an oracle for what exists.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { setConversationProject } from '@/lib/chat/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ projectId: z.string().uuid().nullable() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('not_found', 'That conversation does not exist.');

    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await request.json());
    } catch {
      return jsonError('validation', 'Pick a project, or none.');
    }

    const moved = await setConversationProject({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId: id,
      projectId: body.projectId,
    });
    if (!moved) return jsonError('not_found', 'That conversation or project does not exist.');

    return responseBody(body.projectId);
  } catch (e) {
    return errorResponse(e);
  }
}

function responseBody(projectId: string | null): Response {
  return Response.json({ projectId });
}
