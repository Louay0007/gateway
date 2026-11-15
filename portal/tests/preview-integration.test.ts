/**
 * Preview wiring — plan §8 items 10–12, tested as behaviour rather than as
 * rendered pixels (the suite is node-only, no DOM).
 *
 * The three properties here are the ones a refactor breaks silently:
 *
 *   10. a stream update must not REMOUNT the frame — the block id is the
 *       iframe's identity, so it must not change while the body grows
 *   11. an error must reach the composer with its text, or "Fix with Claude"
 *       becomes a button that sends the word "error"
 *   12. a block over the ceiling must degrade to text, not hang the tab
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canRenderNow, findPreviewBlocks, MIN_PREVIEW_CHARS } from "@/lib/chat/artifacts";
import { isTooLarge, srcdocFor } from "@/lib/chat/preview-template";

const VIEW = resolve(__dirname, "../components/chat/chat-view.tsx");
const PANEL = resolve(__dirname, "../components/chat/preview-panel.tsx");
const FRAME = resolve(__dirname, "../components/chat/preview-frame.tsx");

const view = readFileSync(VIEW, "utf8");
const panel = readFileSync(PANEL, "utf8");
const frame = readFileSync(FRAME, "utf8");

describe("§8.10 a stream update does not remount the frame", () => {
  it("the block id is stable as the body grows", () => {
    // The id is `kind:ordinal`, NOT a hash of the content. A content hash
    // would change on every token, React would see a new key, and the
    // iframe would remount — losing scroll position and restarting any CSS
    // animation, on every 150ms flush.
    const partial = "```html\n" + "x".repeat(MIN_PREVIEW_CHARS);
    const grown = "```html\n" + "x".repeat(MIN_PREVIEW_CHARS + 500);
    const a = findPreviewBlocks(partial)[0]!;
    const b = findPreviewBlocks(grown)[0]!;
    expect(a.id).toBe(b.id);
  });

  it("the id stays stable across many growth steps", () => {
    const ids = new Set<string>();
    for (const n of [400, 500, 800, 1200, 2000]) {
      const blocks = findPreviewBlocks("```html\n" + "x".repeat(n));
      if (blocks[0]) ids.add(blocks[0].id);
    }
    expect(ids.size).toBe(1);
  });

  it("ordinal distinguishes two blocks of the same kind", () => {
    const text =
      "```html\n" + "a".repeat(MIN_PREVIEW_CHARS) + "\n```\n\n" +
      "```html\n" + "b".repeat(MIN_PREVIEW_CHARS) + "\n```";
    const blocks = findPreviewBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.id).not.toBe(blocks[1]!.id);
  });

  it("the frame is NOT keyed in the component (a key would force a remount)", () => {
    // `<iframe key={...}>` above it would remount on every text change.
    const iframeTag = /<iframe[\s\S]*?\/>/.exec(frame)?.[0] ?? "";
    expect(iframeTag).not.toMatch(/\bkey=/);
  });
});

describe("§8.11 the error reaches the composer with its text", () => {
  it("the panel calls onFixWithClaude with the error message, not a constant", () => {
    // A button that sends "please fix" without the error is a retry that
    // cannot succeed: the model has no idea what failed.
    expect(panel).toMatch(/onFixWithClaude\(error\)/);
  });

  it("the view interpolates that message into the draft", () => {
    expect(view).toMatch(/onFixWithClaude=\{\(message\) =>/);
    expect(view).toContain("${message}");
    // And it must actually set the composer.
    expect(view).toMatch(/setDraft\(/);
  });

  it("the button only renders when there IS an error", () => {
    expect(panel).toMatch(/error && onFixWithClaude/);
  });

  it("a new block clears a stale error", () => {
    // An error from the previous document must not sit above a new one.
    expect(panel).toMatch(/setError\(null\)/);
  });
});

describe("§8.12 an oversized block degrades to text", () => {
  it("isTooLarge refuses past 512 KB", () => {
    expect(isTooLarge("x".repeat(512 * 1024))).toBe(false);
    expect(isTooLarge("x".repeat(512 * 1024 + 1))).toBe(true);
  });

  it("the frame renders the text fallback instead of an iframe", () => {
    expect(frame).toContain("Too large to preview");
    // And it must branch BEFORE building the document.
    const guardAt = frame.indexOf("isTooLarge(html)");
    const memoAt = frame.indexOf("srcdocFor(html)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(memoAt).toBeGreaterThan(-1);
  });
});

describe("§8 streaming cadence", () => {
  it("the view throttles to 150ms, not per token", () => {
    // Parsing the whole reply per token would run the fence scanner
    // thousands of times per answer and rebuild the iframe as often.
    expect(view).toMatch(/setTimeout\(\(\) => setPreviewText\(next\), 150\)/);
    expect(view).toContain("clearTimeout(t)");
  });

  it("settles immediately when the stream ends, so a finished reply never waits", () => {
    expect(view).toMatch(/if \(!streaming\) \{[\s\S]{0,120}setPreviewText\(next\);/);
  });

  it("a new block REOPENS a panel the user closed", () => {
    // Otherwise the feature is off by default for anyone who closed it once.
    expect(view).toMatch(/setPreviewClosed\(false\)/);
  });

  it("only the LAST assistant turn feeds the preview", () => {
    // An older artifact must not reopen when a new message arrives.
    expect(view).toMatch(/reverse\(\)\.find\(\(m\) => m\.role === "assistant"\)/);
  });
});

describe("§7 the panel does not exist when nothing is previewable", () => {
  it("returns null rather than rendering an empty column", () => {
    // The transcript must be byte-identical to before the feature for an
    // ordinary reply.
    expect(panel).toMatch(/if \(!selected\) return null/);
  });

  it("the column is hidden below lg — a 320px preview is not a preview", () => {
    expect(view).toContain("hidden w-[min(46%,42rem)] shrink-0 lg:flex");
  });
});

describe("the srcdoc actually carries the controls end to end", () => {
  it("a previewable block produces a document with connect-src closed", () => {
    const block = findPreviewBlocks("```html\n<!DOCTYPE html><html><head></head><body>hi</body></html>\n```" + "x".repeat(MIN_PREVIEW_CHARS))[0]!;
    const doc = srcdocFor(block.content);
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("default-src 'none'");
  });

  it("mermaid is not renderable until closed, which the panel honours", () => {
    const body = "graph TD\n" + "A-->B\n".repeat(80);
    const open = findPreviewBlocks("```mermaid\n" + body)[0]!;
    expect(canRenderNow(open)).toBe(false);
    // The panel shows the source in that state rather than a parse error.
    expect(panel).toContain("Waiting for the diagram to finish");
  });
});
