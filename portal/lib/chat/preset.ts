/**
 * Generation settings — the pure half, with no database import.
 *
 * Split out so the merge can be unit-tested: a module that imports `@/db`
 * throws at import time without DATABASE_URL, which would make the one
 * piece of logic worth checking the one piece that cannot be.
 *
 * Three scopes, resolved in one order (global → model → chat):
 *
 *   chat_presets (scope='')        every chat at all
 *   chat_presets (scope=alias)     every chat on that alias
 *   conversations.settings         this chat only
 *
 * jsonb rather than columns because the parameter set belongs to the
 * provider, and a new tuning knob must not be a migration. The trade is
 * that nothing validates on write; `readSettings` validates on read and
 * drops what it cannot understand, so an older shape never 500s a chat.
 *
 * NOTHING HERE IS BILLING DATA. Tokens and cost live in typed columns.
 */
import { z } from 'zod';

/**
 * The effort levels `config/litellm.yaml` accepts. The deployment pins a
 * floor at `max` for the thinking aliases, so `low` is deliberately absent:
 * offering a knob that the deployment clamps would be a control that lies.
 */
export const REASONING_EFFORTS = ['medium', 'high', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const GenerationSettings = z.object({
  /** Prepended as a `system` message by the server, never by the client. */
  systemPrompt: z.string().max(8000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(65536).optional(),
  /**
   * Per-turn deliberation dial (audit #14). A request param, so it is free
   * to expose — but it moves cost, so the UI labels the trade rather than
   * presenting it as a free quality slider.
   */
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  /**
   * Whether this chat may search the web. Off unless asked, because a
   * search result is untrusted text entering the prompt.
   */
  webSearch: z.boolean().optional(),
});

export type GenerationSettings = z.infer<typeof GenerationSettings>;

/** Parse a stored jsonb value. Unknown shape = no overrides, not an error. */
export function readSettings(raw: unknown): GenerationSettings {
  const parsed = GenerationSettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Merge layers, later winning. An undefined value never clears a set one:
 * spreading `{temperature: undefined}` over a preset would drop it, and
 * that failure is silent (the chat just stops honouring the prompt).
 */
export function mergeSettings(
  ...layers: (GenerationSettings | null | undefined)[]
): GenerationSettings {
  const out: GenerationSettings = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer) as [keyof GenerationSettings, unknown][]) {
      if (value !== undefined && value !== null && value !== '') out[key] = value as never;
    }
  }
  return out;
}
