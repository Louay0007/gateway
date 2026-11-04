/**
 * Engine client behaviour when the engine is absent, slow, or angry.
 *
 * The point of these tests is the DEGRADATION contract, not the happy path:
 * an unconfigured engine must say so (not blame the network), an oversized
 * file must be rejected locally before a megabyte crosses the wire, and a
 * typed 415 from the engine must survive as a user-actionable code rather
 * than collapsing into a generic failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteFromIndex,
  engineBase,
  engineConfigured,
  engineHealth,
  extractDocument,
  indexConversation,
  searchConversations,
} from '@/lib/engine/client';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  // A clean slate per test; each case opts in to what it needs.
  delete process.env.ENGINE_TOKEN;
  delete process.env.ENGINE_URL;
  delete process.env.ENGINE_MAX_UPLOAD_BYTES;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('configuration', () => {
  it('reports itself unconfigured when no token is set', () => {
    expect(engineConfigured()).toBe(false);
  });

  it('treats a whitespace token as unset', () => {
    // `ENGINE_TOKEN=" "` must not count as configured — that is the same
    // bug as a blank token authenticating everyone, one layer up.
    process.env.ENGINE_TOKEN = '   ';
    expect(engineConfigured()).toBe(false);
  });

  it('resolves an explicit URL and strips a trailing slash', () => {
    process.env.ENGINE_URL = 'http://engine.internal:9000/';
    expect(engineBase()).toBe('http://engine.internal:9000');
  });

  it('reads the environment at call time, not import time', () => {
    // A module-scope read would freeze the value before a test (or a
    // runtime secret injection) could set it.
    expect(engineBase()).toContain('8099');
    process.env.ENGINE_URL = 'http://late-bound:1234';
    expect(engineBase()).toBe('http://late-bound:1234');
  });
});

describe('extractDocument degradation', () => {
  it('refuses without a token and does not call the network', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await extractDocument(new Uint8Array([1, 2, 3]), 'a.txt');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an empty file before dispatch', async () => {
    process.env.ENGINE_TOKEN = 't';
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await extractDocument(new Uint8Array(), 'empty.txt');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('empty');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an oversized file locally, in MB a user can read', async () => {
    process.env.ENGINE_TOKEN = 't';
    process.env.ENGINE_MAX_UPLOAD_BYTES = '1048576'; // 1MB
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await extractDocument(new Uint8Array(2 * 1024 * 1024), 'big.pdf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('too_large');
      // "2.0MB" and "1.0MB", not raw byte counts.
      expect(res.message).toContain('2.0MB');
      expect(res.message).toContain('1.0MB');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('preserves a typed engine error instead of flattening it', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'encrypted', message: 'file is encrypted and cannot be read' }, 422),
    );
    const res = await extractDocument(new Uint8Array([1]), 'locked.pdf');
    expect(res.ok).toBe(false);
    // A 415/422 is the USER's file; the UI must be able to say why.
    if (!res.ok) expect(res.code).toBe('encrypted');
  });

  it('maps an unsupported type through unchanged', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'unsupported_type', message: 'unsupported file type: bin' }, 415),
    );
    const res = await extractDocument(new Uint8Array([1]), 'thing.bin');
    if (!res.ok) expect(res.code).toBe('unsupported_type');
  });

  it('reports a timeout as a timeout, not as unreachable', async () => {
    process.env.ENGINE_TOKEN = 't';
    const abort = new Error('aborted');
    abort.name = 'TimeoutError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);
    const res = await extractDocument(new Uint8Array([1]), 'slow.pdf');
    if (!res.ok) expect(res.code).toBe('timeout');
  });

  it('reports a network failure as unavailable', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const res = await extractDocument(new Uint8Array([1]), 'a.txt');
    if (!res.ok) expect(res.code).toBe('unavailable');
  });

  it('returns the parsed document on success', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        kind: 'pdf',
        text: 'extracted body',
        truncated: false,
        pages: null,
        chars: 14,
        filename: 'a.pdf',
      }),
    );
    const res = await extractDocument(new Uint8Array([1]), 'a.pdf');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('pdf');
      expect(res.value.text).toBe('extracted body');
    }
  });

  it('sends the bearer token and never puts it in the body', async () => {
    process.env.ENGINE_TOKEN = 'super-secret';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ kind: 'text', text: 'x', truncated: false, pages: null, chars: 1, filename: 'a.txt' }));
    await extractDocument(new Uint8Array([1]), 'a.txt');
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer super-secret');
    // The browser must never learn the token.
    expect(JSON.stringify(init.body ?? '')).not.toContain('super-secret');
  });
});

describe('searchConversations', () => {
  it('is unavailable without a token, so the sidebar can hide the box', async () => {
    const res = await searchConversations({ query: 'x', orgId: 'o', userId: 'u' });
    expect(res.ok).toBe(false);
  });

  it('treats an empty query as an empty result, not an error', async () => {
    // The sidebar calls on every keystroke, including the delete.
    process.env.ENGINE_TOKEN = 't';
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await searchConversations({ query: '   ', orgId: 'o', userId: 'u' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.hits).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('always sends both tenant fields', async () => {
    // A missing org is the cross-tenant bug; the client must never omit it.
    process.env.ENGINE_TOKEN = 't';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ hits: [], total: 0 }));
    await searchConversations({ query: 'q', orgId: 'org-1', userId: 'user-1' });
    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.org_id).toBe('org-1');
    expect(body.user_id).toBe('user-1');
  });

  it('degrades to a typed failure rather than throwing at the caller', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const res = await searchConversations({ query: 'q', orgId: 'o', userId: 'u' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unavailable');
  });
});

describe('indexing is best-effort', () => {
  it('returns false instead of throwing when unreachable', async () => {
    // A failed index write must never fail the turn that produced it.
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const ok = await indexConversation({
      conversationId: 'c1',
      orgId: 'o',
      userId: 'u',
      title: 't',
      body: 'b',
      createdAt: '2026-11-01',
    });
    expect(ok).toBe(false);
  });

  it('returns false without a token and does not dispatch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const ok = await deleteFromIndex('c1');
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('engineHealth', () => {
  it('distinguishes unconfigured from down', async () => {
    // An operator who never enabled the engine must not see "service down".
    expect(await engineHealth()).toEqual({ configured: false });

    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const health = await engineHealth();
    expect(health).toEqual({ configured: true, ok: false });
  });

  it('reports version and limits when healthy', async () => {
    process.env.ENGINE_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ok: true, version: '0.1.0', maxUploadBytes: 1024 }),
    );
    const health = await engineHealth();
    expect(health).toEqual({ configured: true, ok: true, version: '0.1.0', maxUploadBytes: 1024 });
  });
});
