/**
 * Custom instructions — "about me" and "how to respond" (audit #13).
 *
 * One row per user, two fields. Deliberately NOT in `chat_presets`: those
 * are generation parameters resolved per alias and per chat, and a chat may
 * override them. "Who I am" must not be overridable from one conversation's
 * settings, or a prompt injected into a single chat could re-identify the
 * user. Separation here is a security property, not tidiness.
 *
 * The data already existed as `chat_presets` scope `''` + systemPrompt; this
 * gives it an honest home and a UI, and leaves the preset scope for what it
 * was designed for.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';

export interface Instructions {
  aboutUser: string;
  responseStyle: string;
  updatedAt: string | null;
}

/** Caps, matching the column intent: this is a paragraph, not a file. */
export const MAX_ABOUT = 4000;
export const MAX_STYLE = 2000;

export async function loadInstructions(userId: string): Promise<Instructions> {
  const rows = (await db.execute(sql`
    SELECT about_user, response_style, updated_at
      FROM custom_instructions
     WHERE user_id = ${userId}::uuid
  `)) as unknown as {
    about_user: string;
    response_style: string;
    updated_at: string | Date;
  }[];
  const row = rows[0];
  if (!row) return { aboutUser: '', responseStyle: '', updatedAt: null };
  return {
    aboutUser: row.about_user,
    responseStyle: row.response_style,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

/**
 * Upsert. An empty pair deletes the row rather than storing blanks, so
 * "clear my instructions" leaves nothing behind to resurrect later.
 */
export async function saveInstructions(input: {
  organizationId: string;
  userId: string;
  aboutUser?: string;
  responseStyle?: string;
}): Promise<Instructions> {
  const about = (input.aboutUser ?? '').trim().slice(0, MAX_ABOUT);
  const style = (input.responseStyle ?? '').trim().slice(0, MAX_STYLE);

  if (!about && !style) {
    await db.execute(sql`DELETE FROM custom_instructions WHERE user_id = ${input.userId}::uuid`);
    return { aboutUser: '', responseStyle: '', updatedAt: null };
  }

  await db.execute(sql`
    INSERT INTO custom_instructions (user_id, organization_id, about_user, response_style, updated_at)
    VALUES (${input.userId}::uuid, ${input.organizationId}::uuid, ${about}, ${style}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET about_user     = EXCLUDED.about_user,
          response_style = EXCLUDED.response_style,
          organization_id = EXCLUDED.organization_id,
          updated_at     = now()
  `);

  return loadInstructions(input.userId);
}
