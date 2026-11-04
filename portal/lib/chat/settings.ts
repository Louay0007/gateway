/**
 * Where each settings layer is stored, and how they resolve for one turn.
 * The pure merge lives in `preset.ts`; this file is only the database side.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  mergeSettings,
  readSettings,
  type GenerationSettings,
} from '@/lib/chat/preset';

export { GenerationSettings, mergeSettings, readSettings } from '@/lib/chat/preset';

/**
 * The effective settings for one turn: global preset, then the alias's
 * preset, then the conversation's own overrides.
 *
 * A missing row is simply an absent layer, so a new account needs no row
 * and no backfill.
 */
export async function resolveSettings(input: {
  userId: string;
  alias: string;
  conversationSettings: unknown;
}): Promise<GenerationSettings> {
  const rows = (await db.execute(sql`
    SELECT scope, settings
      FROM chat_presets
     WHERE user_id = ${input.userId}::uuid
       AND scope IN ('', ${input.alias})
  `)) as unknown as { scope: string; settings: unknown }[];

  const byScope = new Map(rows.map((r) => [r.scope, readSettings(r.settings)]));
  return mergeSettings(
    byScope.get(''),
    byScope.get(input.alias),
    readSettings(input.conversationSettings),
  );
}

/** Upsert one scope. An empty object clears the row rather than storing junk. */
export async function savePreset(input: {
  userId: string;
  scope: string;
  settings: GenerationSettings;
}): Promise<void> {
  const clean = mergeSettings(input.settings);
  if (Object.keys(clean).length === 0) {
    await db.execute(sql`
      DELETE FROM chat_presets
       WHERE user_id = ${input.userId}::uuid AND scope = ${input.scope}
    `);
    return;
  }
  await db.execute(sql`
    INSERT INTO chat_presets (user_id, scope, settings, updated_at)
    VALUES (${input.userId}::uuid, ${input.scope}, ${JSON.stringify(clean)}::jsonb, now())
    ON CONFLICT (user_id, scope) DO UPDATE
      SET settings = EXCLUDED.settings, updated_at = now()
  `);
}

export async function loadPresets(userId: string): Promise<Record<string, GenerationSettings>> {
  const rows = (await db.execute(sql`
    SELECT scope, settings FROM chat_presets WHERE user_id = ${userId}::uuid
  `)) as unknown as { scope: string; settings: unknown }[];
  return Object.fromEntries(rows.map((r) => [r.scope, readSettings(r.settings)]));
}
