/**
 * /api/chat/memories — what the model remembers (audit #4).
 *
 * GET    list every fact
 * POST   add one by hand (the same write path extraction uses)
 * DELETE all of them
 *
 * DELETE WITH NO BODY WIPES EVERYTHING. That is a deliberately blunt
 * control at a collection URL: it is the "forget me" button, it is what the
 * settings tab offers next to the list, and making the user delete forty
 * rows one at a time would be a dark pattern dressed as granularity. The
 * response reports how many went, so the UI can confirm it worked.
 *
 * A single fact is edited and deleted at /api/chat/memories/[id].
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import {
  forgetAllMemories,
  listMemories,
  rememberFact,
} from '@/lib/chat/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Add = z.object({
  content: z.string().trim().min(1).max(500),
  category: z.string().max(40).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const memories = await listMemories({ organizationId: ctx.orgId, userId: ctx.userId });
    return Response.json({ memories }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();

    let body: z.infer<typeof Add>;
    try {
      body = Add.parse(await request.json());
    } catch {
      return jsonError('validation', 'A memory needs some text.');
    }

    const memory = await rememberFact({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      content: body.content,
      category: body.category,
      pinned: true,
    });

    // `null` means it was a duplicate, or it looked like a secret. Both are
    // "we did not add it", which is a conflict rather than a server error.
    if (!memory) {
      return jsonError('conflict', 'That is already remembered, or it looks like a secret and was not saved.');
    }
    return Response.json({ memory }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const removed = await forgetAllMemories({ organizationId: ctx.orgId, userId: ctx.userId });
    return Response.json({ removed });
  } catch (e) {
    return errorResponse(e);
  }
}
