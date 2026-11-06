/**
 * PATCH / DELETE /api/chat/scheduled/[id]
 *
 * PATCH takes `enabled` and the fields a user actually changes. Changing
 * the interval RESETS `nextRunAt`: leaving it alone would mean a schedule
 * switched from monthly to hourly still waits a month for its first run,
 * which reads as broken.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_EVERY_MINUTES = 15;

const Patch = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    title: z.string().max(120),
    alias: z.enum(['fast', 'smart', 'frontier', 'fable']),
    everyMinutes: z.number().int().min(MIN_EVERY_MINUTES).max(60 * 24 * 30),
    enabled: z.boolean(),
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
    if (!UUID.test(id)) return jsonError('not_found', 'That schedule does not exist.');

    let body: z.infer<typeof Patch>;
    try {
      body = Patch.parse(await request.json());
    } catch {
      return jsonError('validation', 'That change could not be read.');
    }

    const reschedule =
      body.everyMinutes === undefined
        ? null
        : `${body.everyMinutes} minutes`;

    const rows = (await db.execute(sql`
      UPDATE scheduled_prompts
         SET prompt        = COALESCE(${body.prompt ?? null}, prompt),
             title         = COALESCE(${body.title ?? null}, title),
             alias         = COALESCE(${body.alias ?? null}, alias),
             enabled       = COALESCE(${body.enabled ?? null}, enabled),
             every_minutes = COALESCE(${body.everyMinutes ?? null}, every_minutes),
             next_run_at   = COALESCE(now() + ${reschedule}::interval, next_run_at)
       WHERE id              = ${id}::uuid
         AND organization_id = ${ctx.orgId}::uuid
         AND user_id         = ${ctx.userId}::uuid
      RETURNING id
    `)) as unknown as { id: string }[];

    if (rows.length === 0) return jsonError('not_found', 'That schedule does not exist.');
    return Response.json({ updated: true });
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
    if (!UUID.test(id)) return jsonError('not_found', 'That schedule does not exist.');

    const rows = (await db.execute(sql`
      DELETE FROM scheduled_prompts
       WHERE id              = ${id}::uuid
         AND organization_id = ${ctx.orgId}::uuid
         AND user_id         = ${ctx.userId}::uuid
      RETURNING id
    `)) as unknown as { id: string }[];

    if (rows.length === 0) return jsonError('not_found', 'That schedule does not exist.');
    return Response.json({ deleted: true });
  } catch (e) {
    return errorResponse(e);
  }
}
