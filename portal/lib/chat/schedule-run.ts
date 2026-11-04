/**
 * Executing a due scheduled prompt (audit #15).
 *
 * DESIGN CONSTRAINT THAT SHAPES EVERYTHING: a scheduled run is a real,
 * metered model call with nobody watching. So it must be
 *   * metered — it goes through the same gateway on the same org key, so it
 *     lands in `usage_records` like a typed turn;
 *   * bounded — one call, capped output, hard timeout, no follow-ups;
 *   * honest — the result is appended to a conversation as a normal
 *     assistant message, so the user can see what it said and what it cost;
 *   * claimable — `FOR UPDATE SKIP LOCKED` so two job workers cannot run
 *     the same schedule twice.
 *
 * It reuses `completeOnce`, not the streaming path: there is no reader to
 * stream to, and collecting a bounded answer is exactly what that function
 * is for.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { completeOnce } from '@/lib/chat/gateway';
import { getChatCredential } from '@/lib/chat/key';
import { appendMessage, finishMessage } from '@/lib/chat/service';
import { log } from '@/lib/log';

/** How many schedules one job pass will run. A bound, not a target. */
const BATCH = 5;
/** Output cap for a scheduled answer. Longer than this is a report, and a
 *  report belongs in a chat where someone is watching the cost. */
const MAX_OUTPUT_TOKENS = 1500;

export interface ScheduleRunResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Claim and run due schedules.
 *
 * The claim is a single UPDATE … RETURNING inside a CTE so the row is marked
 * `last_run_at = now()` and `next_run_at` advanced in the same statement
 * that selects it. If the process dies after the claim, the schedule waits
 * one interval rather than instantly re-running — a duplicate model call is
 * worse than a late one.
 */
export async function runDueSchedules(): Promise<ScheduleRunResult[]> {
  let claimed: {
    id: string;
    organization_id: string;
    user_id: string;
    conversation_id: string | null;
    prompt: string;
    alias: string;
    every_minutes: number;
  }[];

  try {
    claimed = (await db.execute(sql`
      WITH due AS (
        SELECT id FROM scheduled_prompts
         WHERE enabled
           AND next_run_at <= now()
         ORDER BY next_run_at
         FOR UPDATE SKIP LOCKED
         LIMIT ${BATCH}
      )
      UPDATE scheduled_prompts p
         SET last_run_at = now(),
             next_run_at = now() + (p.every_minutes || ' minutes')::interval
        FROM due
       WHERE p.id = due.id
      RETURNING p.id, p.organization_id, p.user_id, p.conversation_id,
                p.prompt, p.alias, p.every_minutes
    `)) as unknown as typeof claimed;
  } catch (e) {
    log.error('schedule claim failed', { error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  const results: ScheduleRunResult[] = [];
  for (const job of claimed) {
    try {
      await runOne(job);
      results.push({ id: job.id, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      log.warn('scheduled prompt failed', { id: job.id, error: message });
      await db
        .execute(sql`
          UPDATE scheduled_prompts
             SET last_status = 'error', last_error = ${message.slice(0, 500)}
           WHERE id = ${job.id}::uuid
        `)
        .catch(() => {});
      results.push({ id: job.id, ok: false, error: message });
    }
  }
  return results;
}

async function runOne(job: {
  id: string;
  organization_id: string;
  user_id: string;
  conversation_id: string | null;
  prompt: string;
  alias: string;
}): Promise<void> {
  // A schedule with no conversation gets one created for it, so the answer
  // has somewhere to live. The title names the schedule rather than the
  // prompt, so a user scanning the sidebar can tell automated chats apart.
  let conversationId = job.conversation_id;
  if (!conversationId) {
    const rows = (await db.execute(sql`
      INSERT INTO conversations (organization_id, user_id, title, model)
      VALUES (${job.organization_id}::uuid, ${job.user_id}::uuid,
              ${`Scheduled: ${job.prompt.slice(0, 40)}`}, ${job.alias})
      RETURNING id
    `)) as unknown as { id: string }[];
    conversationId = rows[0]?.id ?? null;
    if (!conversationId) throw new Error('could not create a conversation');

    await db.execute(sql`
      UPDATE scheduled_prompts
         SET conversation_id = ${conversationId}::uuid
       WHERE id = ${job.id}::uuid
    `);
  }

  const credential = await getChatCredential({
    organizationId: job.organization_id,
    userId: job.user_id,
    models: [job.alias],
  });

  const userMessageId = await appendMessage({
    conversationId,
    role: 'user',
    content: job.prompt,
  });

  const assistantId = await appendMessage({
    conversationId,
    role: 'assistant',
    content: '',
    model: job.alias,
    status: 'pending',
  });

  const started = Date.now();
  try {
    const result = await completeOnce({
      alias: job.alias,
      gatewayKey: credential.gatewayKey,
      messages: [{ role: 'user', content: job.prompt }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: 180_000,
    });

    await finishMessage({
      messageId: assistantId,
      content: result.content,
      status: 'complete',
      latencyMs: Date.now() - started,
      gatewayRequestId: result.requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      // Telemetry, not money: this turn had no human in it.
      meta: { scheduled: true, scheduleId: job.id, userMessageId },
    });

    await db.execute(sql`
      UPDATE scheduled_prompts
         SET last_status = 'ok', last_error = NULL
       WHERE id = ${job.id}::uuid
    `);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The scheduled run failed.';
    // The assistant row exists and stays, marked as an error: a scheduled
    // prompt that silently vanishes is worse than one that says it failed.
    await finishMessage({
      messageId: assistantId,
      content: '',
      status: 'error',
      error: message,
      latencyMs: Date.now() - started,
      meta: { scheduled: true, scheduleId: job.id },
    });
    throw e;
  }
}
