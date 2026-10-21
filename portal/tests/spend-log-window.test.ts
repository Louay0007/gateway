import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSpendLogs } from '@/lib/litellm/client';

/**
 * The spend-log window.
 *
 * LiteLLM's end date is EXCLUSIVE: `start_date=2026-10-21&end_date=2026-10-21`
 * returns nothing, and the day's rows only appear when the end date is the
 * next day. A same-day window therefore collects zero rows, and the ledger
 * silently stops growing — the collector reports success while recording
 * nothing.
 *
 * getSpendLogs() takes the INCLUSIVE range a caller means and widens it
 * here, so no caller can get that wrong. This file pins that behaviour.
 */
describe('getSpendLogs window', () => {
  const original = globalThis.fetch;
  const originalKey = process.env.LITELLM_MASTER_KEY;
  const requested: string[] = [];

  beforeEach(() => {
    requested.length = 0;
    process.env.LITELLM_MASTER_KEY = 'sk-test-master-key';
    globalThis.fetch = (async (input: any) => {
      requested.push(String(input));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.LITELLM_MASTER_KEY;
    else process.env.LITELLM_MASTER_KEY = originalKey;
  });

  it('asks for the day after the one the caller wants', async () => {
    await getSpendLogs({ startDate: '2026-10-21', endDate: '2026-10-21' });

    expect(requested).toHaveLength(1);
    const url = new URL(requested[0]!);
    expect(url.searchParams.get('start_date')).toBe('2026-10-21');
    expect(url.searchParams.get('end_date')).toBe('2026-10-22');
  });

  it('keeps a multi-day range inclusive of its last day', async () => {
    await getSpendLogs({ startDate: '2026-10-19', endDate: '2026-10-21' });

    const url = new URL(requested[0]!);
    expect(url.searchParams.get('start_date')).toBe('2026-10-19');
    expect(url.searchParams.get('end_date')).toBe('2026-10-22');
  });

  it('asks for the unsummarized rows, which carry the request body', async () => {
    await getSpendLogs({ startDate: '2026-10-21', endDate: '2026-10-21' });

    // The default is summarize=true, which returns one aggregated row per
    // day and no request body — and the prompt count is derived from the
    // request body.
    const url = new URL(requested[0]!);
    expect(url.searchParams.get('summarize')).toBe('false');
  });
});
