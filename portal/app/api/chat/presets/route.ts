/**
 * GET/PUT /api/chat/presets — the user's generation defaults.
 *
 * Scope is '' (every chat) or an alias (every chat on that tier), keyed by
 * user and NOT by organization: these are preferences, not tenant data. One
 * person's temperature must not become their colleague's.
 *
 * Kept out of the conversation routes because a preset outlives every
 * conversation, and a per-chat value lives on `conversations.settings`
 * (PATCH /api/chat/conversations/[id]) instead.
 */
import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { currentUser } from '@/lib/auth/authorize';
import { GenerationSettings } from '@/lib/chat/preset';
import { loadPresets, savePreset } from '@/lib/chat/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** At most an alias or the global scope; anything else is a client bug. */
const Scope = z.union([z.literal(''), z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)]);

const Put = z.object({
  scope: Scope,
  settings: GenerationSettings,
});

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return jsonError('unauthorized', 'Not signed in');
    return Response.json(
      { presets: await loadPresets(user.id) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return jsonError('unauthorized', 'Not signed in');

    let body: z.infer<typeof Put>;
    try {
      body = Put.parse(await request.json());
    } catch {
      return jsonError('validation', 'Those settings could not be read.');
    }

    await savePreset({ userId: user.id, scope: body.scope, settings: body.settings });
    return Response.json({ presets: await loadPresets(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
