/**
 * Artifact detection — plan §8 items 1–6.
 *
 * The rule that decides what gets rendered in a browser frame, tested
 * without a browser. Every case here is one a real transcript produces:
 * a model writing a full page with no fence language, a two-line snippet
 * inside a sentence, an unterminated fence mid-stream, a script that must
 * never be previewable.
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_PREVIEW_CHARS,
  MAX_PREVIEW_CHARS,
  canRenderNow,
  filenameFor,
  findPreviewBlocks,
  kindFor,
  languageOf,
  previewableBlocks,
  sniffKind,
} from '@/lib/chat/artifacts';

/** A body comfortably over the noise floor. */
const BIG_HTML = '<!DOCTYPE html><html><body>' + '<p>hello</p>'.repeat(60) + '</body></html>';

/** A fence around a body. */
function fence(lang: string, body: string, closed = true): string {
  return '```' + lang + '\n' + body + '\n' + (closed ? '```' : '');
}

describe('languageOf', () => {
  it('lowercases and takes the first token', () => {
    expect(languageOf('HTML')).toBe('html');
    expect(languageOf('html title=index.html')).toBe('html');
    expect(languageOf('  svg  ')).toBe('svg');
    expect(languageOf('')).toBe('');
  });

  it('stops at a brace (mermaid and shiki both use {…} options)', () => {
    expect(languageOf('mermaid {theme: dark}')).toBe('mermaid');
  });
});

describe('§2.2 the noise floor — a snippet is not an artifact', () => {
  it('an html fence over 400 chars IS previewable', () => {
    const blocks = findPreviewBlocks(fence('html', BIG_HTML));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('html');
  });

  it('a 3-line html snippet is NOT — the panel would be noise', () => {
    const tiny = '<div class="a">\n  <p>hi</p>\n</div>';
    expect(tiny.length).toBeLessThan(MIN_PREVIEW_CHARS);
    expect(findPreviewBlocks(fence('html', tiny))).toEqual([]);
  });

  it('is exactly at the floor boundary', () => {
    const at = 'x'.repeat(MIN_PREVIEW_CHARS);
    expect(findPreviewBlocks(fence('html', at))).toHaveLength(1);
    const under = 'x'.repeat(MIN_PREVIEW_CHARS - 1);
    expect(findPreviewBlocks(fence('html', under))).toEqual([]);
  });
});

describe('§2.1 the previewable set', () => {
  it('accepts html, svg, mermaid, markdown, json, csv', () => {
    const big = 'a'.repeat(MIN_PREVIEW_CHARS);
    expect(kindFor('html', big)).toBe('html');
    expect(kindFor('svg', big)).toBe('svg');
    expect(kindFor('mermaid', big)).toBe('mermaid');
    expect(kindFor('markdown', big)).toBe('markdown');
    expect(kindFor('md', big)).toBe('markdown');
    expect(kindFor('json', big)).toBe('json');
    expect(kindFor('csv', big)).toBe('csv');
  });

  it('NEVER previews source code', () => {
    // Putting a script in a frame implies it runs. It does not, and
    // implying it is how somebody pastes a destructive command and presses
    // play. The existing code block already renders these correctly.
    const big = 'x'.repeat(MIN_PREVIEW_CHARS);
    for (const lang of ['js', 'javascript', 'ts', 'typescript', 'py', 'python', 'sh', 'bash', 'zsh']) {
      expect(kindFor(lang, big), lang).toBe('none');
    }
  });

  it('accepts an unknown language as code — no preview, no error', () => {
    expect(kindFor('rust', 'x'.repeat(MIN_PREVIEW_CHARS))).toBe('none');
  });
});

describe('§2.3 sniffing a language-less fence', () => {
  it('recognises a full HTML document', () => {
    expect(sniffKind('<!DOCTYPE html>\n<html>…')).toBe('html');
    expect(sniffKind('<html lang="en">…')).toBe('html');
    expect(sniffKind('  \n  <!doctype HTML>…')).toBe('html');
  });

  it('recognises SVG', () => {
    expect(sniffKind('<svg viewBox="0 0 10 10">…')).toBe('svg');
  });

  it('recognises mermaid diagram keywords', () => {
    expect(sniffKind('graph TD\n  A-->B')).toBe('mermaid');
    expect(sniffKind('flowchart LR\n  A-->B')).toBe('mermaid');
    expect(sniffKind('sequenceDiagram\n  A->>B: hi')).toBe('mermaid');
    expect(sniffKind('gantt\n  title X')).toBe('mermaid');
  });

  it('recognises JSON only when it PARSES', () => {
    expect(sniffKind('{"a":1}')).toBe('json');
    expect(sniffKind('[1,2,3]')).toBe('json');
    // A truncated stream lands here constantly — it must not be called json.
    expect(sniffKind('{"a":1')).toBe('none');
  });

  it('recognises CSV from a delimiter and more than one line', () => {
    expect(sniffKind('a,b,c\n1,2,3')).toBe('csv');
    // One line is a sentence, not a table.
    expect(sniffKind('a,b,c')).toBe('none');
    // Markup with a comma in it is not CSV.
    expect(sniffKind('<div>,</div>\n<span>,</span>')).toBe('none');
  });

  it('says none rather than guessing', () => {
    expect(sniffKind('just some prose')).toBe('none');
  });

  it('a language-less fence with an HTML body becomes an html block', () => {
    const blocks = findPreviewBlocks(fence('', BIG_HTML));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('html');
    expect(blocks[0]!.language).toBe('');
  });
});

describe('§3 streaming — an unterminated fence still renders', () => {
  it('yields a block with closed:false mid-stream', () => {
    const blocks = findPreviewBlocks(fence('html', BIG_HTML, false));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.closed).toBe(false);
  });

  it('marks it closed once the closing fence arrives', () => {
    expect(findPreviewBlocks(fence('html', BIG_HTML, true))[0]!.closed).toBe(true);
  });

  it('HTML renders while open — that is the live part', () => {
    const open = findPreviewBlocks(fence('html', BIG_HTML, false))[0]!;
    expect(canRenderNow(open)).toBe(true);
  });

  it('MERMAID waits for its closing fence', () => {
    // A half-written graph renders as a syntax-error box that then
    // disappears — worse than a moment's wait.
    const body = 'graph TD\n' + 'A-->B\n'.repeat(80);
    const open = findPreviewBlocks(fence('mermaid', body, false))[0]!;
    expect(open.closed).toBe(false);
    expect(canRenderNow(open)).toBe(false);
    const closed = findPreviewBlocks(fence('mermaid', body, true))[0]!;
    expect(canRenderNow(closed)).toBe(true);
  });

  it('a partial block appears as soon as it passes the floor', () => {
    // It must not appear and then vanish a token later.
    const short = 'x'.repeat(MIN_PREVIEW_CHARS - 10);
    expect(findPreviewBlocks(fence('html', short, false))).toEqual([]);
    const long = 'x'.repeat(MIN_PREVIEW_CHARS + 10);
    expect(findPreviewBlocks(fence('html', long, false))).toHaveLength(1);
  });
});

describe('fence parsing edge cases', () => {
  it('handles ~~~ fences', () => {
    const text = '~~~html\n' + BIG_HTML + '\n~~~';
    expect(findPreviewBlocks(text)).toHaveLength(1);
  });

  it('handles an indented fence (a model writing inside a list)', () => {
    const text = '    ```html\n' + BIG_HTML + '\n    ```';
    expect(findPreviewBlocks(text)).toHaveLength(1);
  });

  it('requires a closing fence at least as long as the opener', () => {
    // ```` opened with four backticks, closed with three, is NOT a close.
    const text = '````html\n' + BIG_HTML + '\n```';
    const blocks = findPreviewBlocks(text);
    expect(blocks[0]!.closed).toBe(false);
  });

  it('does not treat a shorter fence of the other character as a close', () => {
    const text = '```html\n' + BIG_HTML + '\n~~~';
    expect(findPreviewBlocks(text)[0]!.closed).toBe(false);
  });

  it('finds several blocks, in document order', () => {
    const text = fence('html', BIG_HTML) + '\n\ntext between\n\n' + fence('svg', '<svg>' + '<g/>'.repeat(120) + '</svg>');
    const blocks = findPreviewBlocks(text);
    expect(blocks.map((b) => b.kind)).toEqual(['html', 'svg']);
  });

  it('gives each block a stable id across stream growth', () => {
    // The id must not change as the body grows, or the iframe remounts.
    const part = fence('html', BIG_HTML.slice(0, 300), false);
    const grown = fence('html', BIG_HTML, false);
    const a = findPreviewBlocks(part)[0]?.id;
    const b = findPreviewBlocks(grown)[0]?.id;
    if (a && b) expect(a).toBe(b);
  });

  it('ignores prose and empty text', () => {
    expect(findPreviewBlocks('')).toEqual([]);
    expect(findPreviewBlocks('just a sentence')).toEqual([]);
  });
});

describe('filenameFor', () => {
  it('takes a filename from the info string', () => {
    expect(filenameFor('html', BIG_HTML, 'html index.html')).toBe('index.html');
  });

  it('takes a filename from a leading HTML comment', () => {
    expect(filenameFor('html', '<!-- chart.html -->' + BIG_HTML, 'html')).toBe('chart.html');
  });

  it('slugs a markdown H1', () => {
    expect(filenameFor('markdown', '# Release Notes\n…'.repeat(30), 'markdown')).toBe('release-notes.md');
  });

  it('falls back to preview.<ext>', () => {
    expect(filenameFor('html', BIG_HTML, 'html')).toBe('preview.html');
    expect(filenameFor('svg', '<svg/>', 'svg')).toBe('preview.svg');
    expect(filenameFor('json', '{}', 'json')).toBe('preview.json');
  });

  it('never returns an empty string', () => {
    for (const kind of ['html', 'svg', 'mermaid', 'markdown', 'json', 'csv'] as const) {
      expect(filenameFor(kind, '', '').length).toBeGreaterThan(0);
    }
  });
});

describe('previewableBlocks / primaryBlock', () => {
  it('returns nothing for a reply with no previewable block', () => {
    expect(previewableBlocks('Here is a sentence.')).toEqual([]);
  });

  it('returns every block for the tab strip', () => {
    const text = fence('html', BIG_HTML) + '\n' + fence('markdown', '# T\n' + 'body '.repeat(200));
    expect(previewableBlocks(text)).toHaveLength(2);
  });
});

describe('MAX_PREVIEW_CHARS', () => {
  it('is 512 KB — a preview cannot be a denial-of-service', () => {
    expect(MAX_PREVIEW_CHARS).toBe(512 * 1024);
  });
});
