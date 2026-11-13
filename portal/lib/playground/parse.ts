/**
 * SSE frame reader for /api/playground.
 *
 * Pure and separate from the component so the frame contract can be tested
 * without a browser or a network: the route emits four frame kinds and a
 * parser that silently ignores an unknown one is how a usage block gets
 * lost and "cost of this call" renders as a dash forever.
 */

export interface PlaygroundUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
}

export type PlaygroundEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; usage: PlaygroundUsage }
  | { kind: 'finish' }
  | { kind: 'error'; message: string };

/**
 * Split a buffer into complete `data:` payloads plus the remainder.
 *
 * SSE frames end with a blank line. A partial frame must be carried over
 * rather than parsed: JSON.parse on half an object throws, and dropping it
 * loses a token in the middle of the answer.
 */
export function drainFrames(buffer: string): { payloads: string[]; rest: string } {
  const payloads: string[] = [];
  let rest = buffer;

  for (;;) {
    const idx = rest.indexOf('\n\n');
    if (idx === -1) break;
    const chunk = rest.slice(0, idx);
    rest = rest.slice(idx + 2);

    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length > 0) payloads.push(payload);
    }
  }

  return { payloads, rest };
}

/** One parsed frame, or null when the payload is not a frame we know. */
export function parseFrame(payload: string): PlaygroundEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.delta === 'string') {
    return { kind: 'delta', text: o.delta };
  }

  if (o.usage && typeof o.usage === 'object') {
    const u = o.usage as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      kind: 'usage',
      usage: {
        inputTokens: num(u.inputTokens),
        outputTokens: num(u.outputTokens),
        costUsd: num(u.costUsd),
        latencyMs: num(u.latencyMs),
      },
    };
  }

  if (typeof o.finish === 'string') return { kind: 'finish' };

  if (o.error && typeof o.error === 'object') {
    const e = o.error as { message?: unknown };
    return {
      kind: 'error',
      message: typeof e.message === 'string' ? e.message : 'The request failed.',
    };
  }

  return null;
}
