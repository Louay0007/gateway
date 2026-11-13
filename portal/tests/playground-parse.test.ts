/**
 * Playground SSE frame contract.
 *
 * The route emits four frame kinds. A parser that silently drops one is how
 * "cost of this call" renders as a dash forever, so every kind is asserted
 * here, plus the two buffer behaviours that lose tokens in production:
 * a frame split across reads, and several frames arriving in one read.
 */
import { describe, it, expect } from 'vitest';

import { drainFrames, parseFrame } from '@/lib/playground/parse';

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe('drainFrames — buffering', () => {
  it('extracts whole frames and keeps the partial tail', () => {
    const buffer = frame({ delta: 'Hel' }) + frame({ delta: 'lo' }) + 'data: {"del';
    const { payloads, rest } = drainFrames(buffer);
    expect(payloads).toHaveLength(2);
    expect(JSON.parse(payloads[0]!)).toEqual({ delta: 'Hel' });
    expect(rest).toBe('data: {"del');
  });

  it('returns nothing when no frame is complete yet', () => {
    const { payloads, rest } = drainFrames('data: {"delta":"par');
    expect(payloads).toEqual([]);
    expect(rest).toBe('data: {"delta":"par');
  });

  it('handles a frame arriving across two reads', () => {
    const whole = frame({ delta: 'split' });
    const cut = Math.floor(whole.length / 2);

    const first = drainFrames(whole.slice(0, cut));
    expect(first.payloads).toEqual([]);

    const second = drainFrames(first.rest + whole.slice(cut));
    expect(second.payloads).toHaveLength(1);
    expect(JSON.parse(second.payloads[0]!)).toEqual({ delta: 'split' });
  });

  it('ignores comments and non-data lines', () => {
    const { payloads } = drainFrames(': keepalive\n\n' + frame({ delta: 'x' }));
    expect(payloads).toHaveLength(1);
  });
});

describe('parseFrame — the four kinds', () => {
  it('reads a delta', () => {
    expect(parseFrame(JSON.stringify({ delta: 'hi' }))).toEqual({
      kind: 'delta',
      text: 'hi',
    });
  });

  it('reads the usage block, preserving null vs zero', () => {
    const ev = parseFrame(
      JSON.stringify({
        usage: { inputTokens: 12, outputTokens: 0, costUsd: null, latencyMs: 812 },
      }),
    );
    expect(ev).toEqual({
      kind: 'usage',
      usage: { inputTokens: 12, outputTokens: 0, costUsd: null, latencyMs: 812 },
    });
    // 0 output tokens is a real answer (a refusal), not a missing value.
    if (ev?.kind === 'usage') expect(ev.usage.outputTokens).toBe(0);
  });

  it('reads finish', () => {
    expect(parseFrame(JSON.stringify({ finish: 'stop' }))).toEqual({ kind: 'finish' });
  });

  it('reads an error with its message', () => {
    expect(parseFrame(JSON.stringify({ error: { message: 'pool spent' } }))).toEqual({
      kind: 'error',
      message: 'pool spent',
    });
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseFrame('{not json')).toBeNull();
  });

  it('returns null for an unknown shape', () => {
    expect(parseFrame(JSON.stringify({ somethingElse: true }))).toBeNull();
  });

  it('falls back to a generic message when an error has none', () => {
    const ev = parseFrame(JSON.stringify({ error: {} }));
    expect(ev?.kind).toBe('error');
    if (ev?.kind === 'error') expect(ev.message.length).toBeGreaterThan(0);
  });
});
