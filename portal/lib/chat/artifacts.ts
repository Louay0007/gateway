/**
 * Artifact detection — which parts of a reply are worth putting in the
 * preview panel, and when a block is still being written. Plan §2.
 *
 * PURE. No React, no DOM, no network, no database. Everything here is a
 * string in and data out, because this is the rule that decides what
 * executes inside a browser frame (§4) — and a rule that can only be
 * exercised through a UI is a rule nobody exercises.
 *
 * WHY DETECTION IS THE DESIGN. The model does not announce "this is an
 * artifact". We infer it from a fenced code block plus a judgement about
 * whether the block is a THING or an EXAMPLE. Get the judgement wrong in
 * one direction and every reply spawns a panel nobody asked for; wrong in
 * the other and the feature never appears.
 */

/** What the preview panel can render, and how. */
export type PreviewKind =
  /** Sandboxed iframe. The headline case. */
  | 'html'
  /** Inline, sanitised — inert once scripts and handlers are stripped. */
  | 'svg'
  /** The existing `streamdown` mermaid renderer, already themed. */
  | 'mermaid'
  /** The existing `streamdown` renderer, already in the product. */
  | 'markdown'
  /** A tree, not a frame: the point is structure. */
  | 'json'
  /** A table, not a frame: the point is rows. */
  | 'csv'
  /** Not previewable. Rendered by the existing code block, unchanged. */
  | 'none';

/**
 * The minimum body size for a block to be worth a panel.
 *
 * 400 characters ≈ 8 lines of ordinary HTML. Below it a block is an
 * illustration inside a sentence ("here is the meta tag you need") and a
 * panel for it is noise the user learns to close without reading. Above it
 * the block is a document.
 *
 * This is the same distinction Claude draws: an artifact is something
 * "you'd put in front of someone".
 */
export const MIN_PREVIEW_CHARS = 400;

/** Hard ceiling. A preview is not a denial-of-service against the tab. */
export const MAX_PREVIEW_CHARS = 512 * 1024;

export interface PreviewBlock {
  /** Stable identity across stream updates: `kind:ordinal`. */
  id: string;
  kind: Exclude<PreviewKind, 'none'>;
  /** The fence's language token as written, or '' when it had none. */
  language: string;
  /** The block's body, WITHOUT the fences. */
  content: string;
  /**
   * True once the closing fence has arrived.
   *
   * A streaming block renders anyway (that is the "live" part), but a
   * consumer that cannot render a partial document — mermaid — must wait
   * for this.
   */
  closed: boolean;
  /** A filename for the header, guessed from the content or the fence. */
  filename: string;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Language → kind
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Languages that map to a preview kind.
 *
 * WHY `js`, `ts`, `py`, `sh` and `bash` ARE ABSENT. They are SOURCE, and the
 * existing code block already renders them correctly. Putting them in a
 * frame that executes would imply they run; they do not, and implying it is
 * how somebody pastes a destructive command and presses play. A preview of
 * a script is its text, which the transcript already shows.
 */
const LANGUAGE_KINDS: Record<string, PreviewKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  json: 'json',
  csv: 'csv',
  tsv: 'csv',
};

/** Normalise a fence info string ("HTML", "html title=x") to a bare token. */
export function languageOf(info: string): string {
  return info.trim().toLowerCase().split(/[\s{]/)[0] ?? '';
}

/**
 * Sniff a language-less fence's kind from its content. Plan §2.3.
 *
 * Mirror of the engine's `sniff`: decide from the CONTENT, not from a claim.
 * A model writing a full page frequently omits the `html` tag on the fence,
 * and a language-less fence is the most common form in real transcripts.
 *
 * Returns 'none' rather than guessing: a wrong kind renders the wrong
 * renderer, and an HTML document shown as a CSV table is worse than no
 * preview.
 */
export function sniffKind(body: string): PreviewKind {
  const head = body.replace(/^\uFEFF/, '').trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  if (head.startsWith('<svg')) return 'svg';
  // Mermaid.js opens with a diagram type keyword.
  if (
    head.startsWith('graph ') ||
    head.startsWith('graph\n') ||
    head.startsWith('flowchart') ||
    head.startsWith('sequencediagram') ||
    head.startsWith('classdiagram') ||
    head.startsWith('erdiagram') ||
    head.startsWith('gantt') ||
    head.startsWith('pie') ||
    head.startsWith('statediagram')
  ) {
    return 'mermaid';
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      // Not JSON. A truncated stream lands here constantly, which is why
      // this returns 'none' instead of 'json' on a parse failure.
      return 'none';
    }
  }
  // A CSV needs a delimiter in its first line and more than one line.
  const lines = body.trim().split('\n');
  if (lines.length > 1 && (lines[0] ?? '').includes(',') && !(lines[0] ?? '').includes('<')) {
    return 'csv';
  }
  return 'none';
}

/** The kind for a fence, by language first, then by sniffing the body. */
export function kindFor(info: string, body: string): PreviewKind {
  const lang = languageOf(info);
  if (lang) return LANGUAGE_KINDS[lang] ?? 'none';
  return sniffKind(body);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Filename guessing
 * ──────────────────────────────────────────────────────────────────────── */

const EXTENSIONS: Record<Exclude<PreviewKind, 'none'>, string> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  markdown: 'md',
  json: 'json',
  csv: 'csv',
};

/**
 * A filename for the panel header.
 *
 * The model sometimes writes `<!-- index.html -->` or a `# title`; the fence
 * sometimes carries one. When none of that exists the name is derived from
 * the kind, because a header saying "Preview" tells the user nothing about
 * which of three tabs they are looking at.
 */
export function filenameFor(kind: Exclude<PreviewKind, 'none'>, content: string, info: string): string {
  // ```` ```html index.html ```` — the info string after the language.
  const fromInfo = info.trim().split(/\s+/)[1];
  if (fromInfo && /^[\w.-]+\.[a-z0-9]{1,8}$/i.test(fromInfo)) return fromInfo;

  // A leading HTML comment naming the file.
  const comment = /^\s*<!--\s*([\w.-]+\.[a-z0-9]{1,8})\s*-->/i.exec(content);
  if (comment) return comment[1]!;

  // A markdown H1, slugged.
  if (kind === 'markdown') {
    const h1 = /^\s*#\s+(.{1,80})$/m.exec(content);
    if (h1) {
      const slug = h1[1]!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      if (slug) return `${slug}.md`;
    }
  }

  return `preview.${EXTENSIONS[kind]}`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Fence parsing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Find every previewable fenced block in a reply. Plan §2.
 *
 * STREAMING-AWARE. During a stream the trailing fence has no close, and the
 * whole point is to render it anyway. So an unterminated fence yields a
 * block with `closed: false` rather than being discarded.
 *
 * NOT A MARKDOWN PARSER, ON PURPOSE. A real parser would need the whole
 * document before it could produce a tree, which is exactly what a stream
 * does not have. Fence scanning is line-based and can run on a prefix, which
 * is the only property this needs.
 */
export function findPreviewBlocks(text: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const lines = text.split('\n');

  let inFence = false;
  let fenceMarker = '';
  let info = '';
  let body: string[] = [];
  let ordinal = 0;

  const flush = (closed: boolean) => {
    const content = body.join('\n');
    const kind = kindFor(info, content);
    if (kind !== 'none') {
      // The noise floor. A closed block must be big enough to be a thing;
      // an OPEN one is only ever shown when it already passes, so the
      // panel does not appear and then vanish a token later.
      if (content.length >= MIN_PREVIEW_CHARS) {
        blocks.push({
          id: `${kind}:${ordinal++}`,
          kind: kind as Exclude<PreviewKind, 'none'>,
          language: languageOf(info),
          content,
          closed,
          filename: filenameFor(kind as Exclude<PreviewKind, 'none'>, content, info),
        });
      }
    }
    inFence = false;
    fenceMarker = '';
    info = '';
    body = [];
  };

  for (const line of lines) {
    if (!inFence) {
      const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (open) {
        inFence = true;
        // The opening marker's own length is the minimum closing length.
        fenceMarker = open[2]!;
        info = open[3] ?? '';
        body = [];
      }
      continue;
    }

    // A closing fence is at least as long as the opener and carries no
    // info string. Indented fences are accepted: a model writing inside a
    // list item produces four-space-indented blocks.
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1]!.length >= fenceMarker.length && close[1]![0] === fenceMarker[0]) {
      flush(true);
      continue;
    }
    body.push(line);
  }

  // Still open: the stream has not finished this block.
  if (inFence) flush(false);

  return blocks;
}

/**
 * The block to show, and whether the panel should exist at all.
 *
 * A single previewable block is shown directly. Several become tabs (§5.2),
 * which the panel handles — this function only answers "is there anything".
 */
export function primaryBlock(blocks: PreviewBlock[]): PreviewBlock | null {
  return blocks[0] ?? null;
}

/**
 * Should a block be rendered yet?
 *
 * HTML and friends render while streaming — that is the live part. Mermaid
 * waits for its closing fence: a half-written graph renders as a syntax
 * error box that then disappears, which is worse than a moment's wait.
 * SVG renders: browsers recover from a truncated SVG the same way they do
 * from a truncated HTML document.
 */
export function canRenderNow(block: PreviewBlock): boolean {
  if (block.closed) return true;
  return block.kind !== 'mermaid';
}

/** Blocks the panel should offer as tabs. */
export function previewableBlocks(text: string): PreviewBlock[] {
  return findPreviewBlocks(text);
}
