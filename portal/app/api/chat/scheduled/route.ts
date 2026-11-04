/**
 * /api/chat/scheduled — recurring prompts (audit #15).
 *
 * A schedule is a prompt the jobs runner re-runs on an interval and appends
 * the answer to a conversation. This is the CRUD half; execution lives in
 * lib/chat/schedule-run.ts and is claimed by `scripts/jobs.ts`, which
 * already exists and already has run bookkeeping — so this adds a table, not
 * a scheduler.
 *
 * EVERY RUN IS A METERED TURN. That is the whole reason this is gated on an
 * active org and a live plan rather than being a free background service:
 * a schedule is exactly an automatic way to spend a customer's tokens, and
 * an unmetered one would be the invariant violation the platform doc opens
 * with. The UI states the cost model next to the interval.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A floor, enforced here rather than in the schema, so it can change
 *  without a migration. Fifteen minutes: anything tighter is a load test. */
const MIN_EVERY_MINUTES = 15;

const Create = z.object({
  prompt: z.string().trim().min(1).max(4000),
  title: z.string().max(120).optional(),
  alias: z.enum(['fast', 'smart', 'frontier']).optional(),
  everyMinutes: z.number().int().min(MIN_EVERY_MINUTES).max(60 * 24 * 30),
  conversationId: z.string().uuid().nullish(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();

    const rows = (await db.execute(sql`
      SELECT id, title, prompt, alias, every_minutes, enabled,
             last_run_at, next_run_at, last_status, last_error, conversation_id, created_at
        FROM scheduled_prompts
       WHERE organization_id = ${ctx.orgId}::uuid
         AND user_id         = ${ctx.userId}::uuid
       ORDER BY created_at DESC
    `)) as unknown as {
      id: string;
      title: string;
      prompt: string;
      alias: string;
      every_minutes: number;
      enabled: boolean;
      last_run_at: string | Date | null;
      next_run_at: string | Date;
      last_status: string | null;
      last_error: string | null;
      conversation_id: string | null;
      created_at: string | Date;
    }[];

    return Response.json(
      {
        schedules: rows.map((r) => ({
          id: r.id,
          title: r.title,
          prompt: r.prompt,
          alias: r.alias,
          everyMinutes: r.every_minutes,
          enabled: r.enabled,
          lastRunAt: iso(r.last_run_at),
          nextRunAt: iso(r.next_run_at),
          lastStatus: r.last_status,
          lastError: r.last_error,
          conversationId: r.conversation_id,
          createdAt: iso(r.created_at),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
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
      return jsonError(
        'validation',
        `A schedule needs a prompt and an interval of at least ${MIN_EVERY_MINUTES} minutes.`,
      );
    }

    // A schedule attached to a chat the caller does not own would append
    // answers into somebody else's transcript.
    if (body.conversationId) {
      const owned = (await db.execute(sql`
        SELECT id FROM conversations
         WHERE id              = ${body.conversationId}::uuid
           AND organization_id = ${ctx.orgId}::uuid
           AND user_id         = ${ctx.userId}::uuid
      `)) as unknown as { id: string }[];
      if (owned.length === 0) return jsonError('not_found', 'That conversation does not exist.');
    }

    const rows = (await db.execute(sql`
      INSERT INTO scheduled_prompts
        (organization_id, user_id, conversation_id, title, prompt, alias,
         every_minutes, next_run_at)
      VALUES (${ctx.orgId}::uuid, ${ctx.userId}::uuid, ${body.conversationId ?? null}::uuid,
              ${body.title ?? ''}, ${body.prompt}, ${body.alias ?? 'smart'},
              ${body.everyMinutes},
              now() + ${`${body.everyMinutes} minutes`}::interval)
      RETURNING id
    `)) as unknown as { id: string }[];

    return Response.json({ id: rows[0]?.id ?? null }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
