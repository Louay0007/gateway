/**
 * GET / PUT /api/chat/instructions — global custom instructions (audit #13).
 *
 * Scoped to the USER, not the org: these are personal ("I write Go, answer
 * in French"), and a colleague must not inherit them. That is also why they
 * are not `chat_presets`, which a per-chat setting can override — this pair
 * is applied before every other layer and wins over none of them.
 *
 * PUT is a full replace of the pair. An empty pair DELETES the row, so
 * "clear" actually clears rather than storing two blank strings that a
 * future migration might treat as set.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { currentUser, requireActiveOrg } from '@/lib/auth/authorize';
import { loadInstructions, MAX_ABOUT, MAX_STYLE, saveInstructions } from '@/lib/chat/instructions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Put = z.object({
  aboutUser: z.string().max(MAX_ABOUT).optional(),
  responseStyle: z.string().max(MAX_STYLE).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return jsonError('unauthorized', 'Not signed in');

    const instructions = await loadInstructions(user.id);
    return Response.json({ instructions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    // `requireActiveOrg` as well as the user: the row carries an org for
    // tenancy hygiene, so it cannot be written without one.
    const ctx = await requireActiveOrg();

    let body: z.infer<typeof Put>;
    try {
      body = Put.parse(await request.json());
    } catch {
      return jsonError('validation', 'Those instructions could not be read.');
    }

    const instructions = await saveInstructions({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      aboutUser: body.aboutUser,
      responseStyle: body.responseStyle,
    });
    return Response.json({ instructions });
  } catch (e) {
    return errorResponse(e);
  }
}
