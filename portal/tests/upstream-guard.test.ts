/**
 * The upstream capability guard.
 *
 * Every rule here was measured against the live upstream on 2026-11-13,
 * not inferred: it answers a body it cannot serve with one opaque 400
 * ("La requête a été rejetée par le modèle.") and no field name, so the
 * only way to know which shapes it refuses is to send them.
 *
 * The case that motivated the guard is the first one below and it is
 * nastier than it looks: agents attach a PDF once and REPLAY that block
 * every later turn, so a single attachment 400s the rest of the
 * conversation. A top-level-only scan misses it, because the block lives
 * inside `tool_result.content[]`.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeRequest, PDF_NOTE, IMAGE_URL_NOTE } from '../../edge/upstream-guard.mjs';

const PDF_DOC = {
  type: 'document',
  source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' },
};

describe('sanitizeRequest — blocks the upstream refuses', () => {
  it('rewrites a PDF document nested inside a tool_result', () => {
    // The exact shape that wedged a live Cowork session.
    const body = {
      model: 'sonnet-5.5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [
                { type: 'text', text: 'PDF file read: cv.pdf' },
                PDF_DOC,
              ],
            },
          ],
        },
      ],
    };
    const { body: out, changed } = sanitizeRequest(body);
    expect(changed).toBe(true);
    const block = out.messages[0].content[0].content[1];
    expect(block).toEqual({ type: 'text', text: PDF_NOTE });
    // The sibling text block is untouched.
    expect(out.messages[0].content[0].content[0]).toEqual({
      type: 'text',
      text: 'PDF file read: cv.pdf',
    });
  });

  it('rewrites a top-level PDF document', () => {
    const { body: out, changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      messages: [{ role: 'user', content: [PDF_DOC, { type: 'text', text: 'summarize' }] }],
    });
    expect(changed).toBe(true);
    expect(out.messages[0].content[0]).toEqual({ type: 'text', text: PDF_NOTE });
  });

  it('rewrites a URL image source', () => {
    const { body: out, changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      messages: [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }],
      }],
    });
    expect(changed).toBe(true);
    expect(out.messages[0].content[0]).toEqual({ type: 'text', text: IMAGE_URL_NOTE });
  });

  it('leaves an inline base64 image alone — it is served and the pixels matter', () => {
    const image = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
    };
    const { body: out, changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      messages: [{ role: 'user', content: [image] }],
    });
    expect(changed).toBe(false);
    expect(out.messages[0].content[0]).toEqual(image);
  });

  it('leaves a document with an inline text source alone — the upstream serves it', () => {
    const doc = {
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: 'hello' },
    };
    const { changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      messages: [{ role: 'user', content: [doc] }],
    });
    expect(changed).toBe(false);
  });

  it('does not mutate the caller body', () => {
    const body = {
      model: 'sonnet-5.5',
      messages: [{ role: 'user', content: [PDF_DOC] }],
    };
    const snapshot = JSON.parse(JSON.stringify(body));
    sanitizeRequest(body);
    expect(body).toEqual(snapshot);
  });

  it('reports "unchanged" for an ordinary turn so the edge can skip the cost', () => {
    const { body: out, changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a' } }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      ],
      tools: [{ name: 'Read', input_schema: { type: 'object', properties: {} } }],
    });
    expect(changed).toBe(false);
    expect(out.messages).toHaveLength(3);
  });

  it('descends into tool schemas without rewriting anything', () => {
    // The walk is generic, so a future block type nested inside a schema
    // must survive intact rather than be flattened by an eager rewrite.
    const schema = {
      type: 'object',
      properties: { doc: { type: 'string' }, rare: { type: 'document' } },
    };
    const { changed } = sanitizeRequest({
      model: 'sonnet-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'f', input_schema: schema }],
    });
    expect(changed).toBe(false);
  });
});
