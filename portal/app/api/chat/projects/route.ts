/**
 * /api/chat/projects — folders with instructions (audit #5).
 *
 * GET  list, with a live conversation count
 * POST create
 *
 * The per-project routes live at [id]/route.ts (PATCH, DELETE=archive) and
 * [id]/chats/route.ts (move a conversation in or out).
 *
 * EVERY HANDLER STARTS WITH `requireActiveOrg`. Ownership is applied inside
 * lib/chat/projects.ts as a WHERE clause rather than a post-fetch check, so
 * a bug here cannot become a cross-tenant read — the row simply is not
 * returned.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { createProject, listProjects } from '@/lib/chat/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Create = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(8000).optional(),
  color: z.string().max(20).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const projects = await listProjects({ organizationId: ctx.orgId, userId: ctx.userId });
    return Response.json({ projects }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();

    let body: z.infer<typeof Create>;
    try {
      body = Create.parse(await request.json());
    } catch {
      return jsonError('validation', 'A project needs a name of 80 characters or fewer.');
    }

    const project = await createProject({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      name: body.name,
      instructions: body.instructions,
      color: body.color,
    });
    return Response.json({ project }, { status: 201 });
  } catch (e) {
    // A duplicate name is the expected failure; the service throws a
    // sentence the user can act on, so it is forwarded as a conflict.
    if (e instanceof Error && e.message.includes('already have a project')) {
      return jsonError('conflict', e.message);
    }
    return errorResponse(e);
  }
}
