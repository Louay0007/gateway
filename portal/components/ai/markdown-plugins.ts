"use client";

import { code } from "@streamdown/code";
import { createMermaidPlugin } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

/**
 * Renderers that Streamdown does NOT ship in its core bundle.
 *
 * Core handles markdown, GFM tables and fenced code — but a fence marked
 * ```mermaid arrives as text, and `$x^2$` arrives as literal dollars,
 * because both need a real renderer behind them. Without these plugins a
 * diagram is a wall of arrows and maths is a string of asterisks.
 *
 * WHY THIS LIVES IN ITS OWN MODULE: mermaid is ~2MB of parser. It is
 * imported here, in a client module, so that it lands in its own chunk and
 * only downloads when a transcript actually contains a diagram. Pulling it
 * into `chat-view` directly would put it on the critical path of every
 * conversation, including the empty one.
 *
 * `katex` styling is imported in `globals.css` rather than injected at
 * runtime so it is fingerprinted and cached like the rest of the CSS
 * instead of being re-parsed on each mount.
 */

const mermaid = createMermaidPlugin({
  config: {
    // The transcript is user-visible but the markup is model-authored;
    // `strict` disables click handlers and raw HTML inside a chart.
    securityLevel: "strict",
    startOnLoad: false,
    fontFamily: "var(--font-sans, ui-sans-serif), system-ui, sans-serif",
    // Colours are set per-theme at render time below, not baked here.
  },
});

export const markdownPlugins: PluginConfig = {
  code,
  math: {
    name: "katex",
    type: "math",
    remarkPlugin: remarkMath,
    // `throwOnError: false` keeps one malformed expression from blanking
    // the whole answer during a stream, when braces are half-arrived.
    rehypePlugin: [rehypeKatex, { throwOnError: false, strict: false }],
  },
  mermaid,
};
