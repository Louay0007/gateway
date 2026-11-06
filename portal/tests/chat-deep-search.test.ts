/**
 * Deep search: the page text, and what is dropped on the way in.
 *
 * The parse is a regex strip on purpose (see lib/chat/web-search.ts), so the
 * tests below are about the two ways a strip goes wrong: markup left in the
 * prose, and prose removed with the markup.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_PAGE_CHARS,
  decodeEntities,
  htmlToText,
} from '@/lib/chat/web-search';
import { buildSystemPrompt, buildUserTurn } from '@/lib/chat/prompt';

describe('htmlToText', () => {
  it('removes script and style CONTENTS, not just their tags', () => {
    // Stripping tags first would leave `var a = "hi"` visible as prose.
    const html = '<p>real</p><script>var a = "<p>hi</p>";</script><style>.x{color:red}</style>';
    const text = htmlToText(html);
    expect(text).toContain('real');
    expect(text).not.toContain('var a');
    expect(text).not.toContain('color:red');
  });

  it('keeps paragraph breaks so structure survives', () => {
    const text = htmlToText('<p>one</p><p>two</p>');
    expect(text.split('\n')).toEqual(['one', 'two']);
  });

  it('drops navigation chrome that is never the answer', () => {
    const html =
      '<nav>Home | About</nav><p>the answer</p><footer>© 2026</footer>';
    const text = htmlToText(html);
    expect(text).toContain('the answer');
    expect(text).not.toContain('Home');
    expect(text).not.toContain('2026');
  });

  it('decodes entities so the model reads words, not `&amp;`', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>')).toBe('a & b <c> "d"');
  });

  it('strips a bidi override hidden in page text', () => {
    // Same injection as a snippet: page bodies are the larger surface.
    expect(htmlToText('<p>safe‮evil</p>')).toBe('safeevil');
  });

  it('caps what one page can contribute', () => {
    const text = htmlToText(`<p>${'x'.repeat(50_000)}</p>`);
    expect(text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS * 2);
  });

  it('survives a malformed tag rather than throwing', () => {
    expect(() => htmlToText('<p>unclosed <b>bold')).not.toThrow();
  });
});

describe('decodeEntities', () => {
  it('handles numeric forms including hex', () => {
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
  });

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeEntities('&notreal;')).toBe('&notreal;');
  });
});

describe('the prompt with page text', () => {
  it('labels page text so a quote cannot be mistaken for the summary', () => {
    const turn = buildUserTurn({
      text: 'what does it say?',
      webResults: [
        { title: 'Docs', url: 'https://e.com/a', snippet: 'summary', text: 'THE PAGE BODY' },
      ],
    });
    expect(turn).toContain('THE PAGE BODY');
    expect(turn).toContain('quote from this');
    expect(turn.indexOf('summary')).toBeLessThan(turn.indexOf('THE PAGE BODY'));
  });

  it('sends only the summary on a plain search', () => {
    const turn = buildUserTurn({
      text: 'q',
      webResults: [{ title: 'Docs', url: 'https://e.com/a', snippet: 'summary' }],
    });
    expect(turn).toContain('summary');
    expect(turn).not.toContain('page text');
  });

  it('tells the model a deep turn has real pages and a plain one does not', () => {
    const deep = buildSystemPrompt({ webSearch: { query: 'q', results: 2, deep: true } }) ?? '';
    const plain = buildSystemPrompt({ webSearch: { query: 'q', results: 2 } }) ?? '';
    expect(deep).toContain('page TEXT');
    expect(plain).toContain('SUMMARIES');
    expect(plain).not.toContain('page TEXT');
  });
});
