"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Streamdown } from "streamdown";

import { markdownPlugins } from "@/components/ai/markdown-plugins";
import { cn } from "@/lib/utils";

/**
 * Markdown — the assistant's reply, rendered.
 *
 * WHY A COMPONENT AND NOT AN INLINE `<Streamdown>`: a diagram's palette is
 * baked into the SVG at render time, so mermaid has to be told which theme
 * it is drawing for. That means this subtree needs `useTheme`, and reading
 * the theme during the server pass would either bake `light` into a dark
 * transcript or throw a hydration mismatch. Keeping the hook here means
 * only this component is client-only, not the whole transcript.
 *
 * ON `dangerouslySetInnerHTML`: not used. Streamdown parses markdown to a
 * React tree and hardens raw HTML, which is what makes it safe to feed
 * model output into. `linkSafety` puts an interstitial in front of any
 * link the model invents, since a model can be talked into writing one.
 */

/** Diagram colours, expressed against the app's own tokens. */
const MERMAID_LIGHT = {
  theme: "default" as const,
  themeVariables: {
    background: "#ffffff",
    primaryColor: "#f4f4f5",
    primaryTextColor: "#18181b",
    primaryBorderColor: "#d4d4d8",
    lineColor: "#71717a",
    secondaryColor: "#e4e4e7",
    tertiaryColor: "#fafafa",
    fontSize: "14px",
  },
};

const MERMAID_DARK = {
  theme: "dark" as const,
  themeVariables: {
    background: "transparent",
    primaryColor: "#27272a",
    primaryTextColor: "#e4e4e7",
    primaryBorderColor: "#3f3f46",
    lineColor: "#a1a1aa",
    secondaryColor: "#3f3f46",
    tertiaryColor: "#18181b",
    fontSize: "14px",
  },
};

/**
 * Type and block styling for an answer.
 *
 * An answer is a document — headings, lists, tables, code — rendered at
 * reading width. The table rules matter most: a model-written comparison
 * arrives as a bare `<table>` with no borders and no padding, and without
 * these it reads as run-together words.
 */
const PROSE = cn(
  "max-w-none text-[15px] leading-[1.7]",
  // A reply is a document, so each BLOCK derives its own direction from its
  // first strong character (`unicode-bidi: plaintext`). An Arabic paragraph
  // inside an English answer gets RTL ordering and punctuation without any
  // language detection; an English paragraph is unaffected. Applying it to
  // blocks rather than the root keeps a mixed answer readable either way.
  "[&_p]:[unicode-bidi:plaintext] [&_li]:[unicode-bidi:plaintext]",
  "[&_h1]:[unicode-bidi:plaintext] [&_h2]:[unicode-bidi:plaintext] [&_h3]:[unicode-bidi:plaintext]",
  // Code and URLs are LTR facts, not prose: a bidi algorithm run over
  // `createConversation` in an RTL paragraph would move its punctuation.
  "[&_code]:[unicode-bidi:isolate] [&_code]:[direction:ltr] [&_pre]:[direction:ltr]",
  "[&_a]:[unicode-bidi:isolate]",
  "[&_*]:break-words",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-2",
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
  // A step below h3, or the two read as the same heading and the outline
  // collapses — models use h4 for the last level of a nested answer.
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-muted-foreground",
  "[&_p]:my-3 [&_p]:first:mt-0 [&_p]:last:mb-0",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li>p]:my-1",
  // A task item already draws a checkbox, so a disc in front of it is a
  // second bullet on the same line. Streamdown keeps the native input, which
  // at browser defaults is a 13px box with no vertical alignment against the
  // 15px text; size and accent it so it sits in the text's own rhythm.
  "[&_li:has(>input[type=checkbox])]:list-none",
  "[&_li>input[type=checkbox]]:mr-1.5 [&_li>input[type=checkbox]]:size-3.5 [&_li>input[type=checkbox]]:translate-y-[1px] [&_li>input[type=checkbox]]:accent-foreground",
  "[&_ul:has(>li>input[type=checkbox])]:pl-1",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-6 [&_hr]:border-border/60",
  // Inline code carries a tint; a fenced block's <pre> owns the surface.
  "[&_code]:rounded [&_code]:bg-chat-code-bg [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  // NO FRAME ON `pre`. Streamdown already wraps a fence twice — a bordered
  // `code-block` holding a bordered, padded `code-block-body`. Adding a
  // border, a tint and 12px of padding here made three nested frames and
  // 36px of dead margin before the first line of code, which at phone width
  // is most of the block. This rule only owns the type.
  "[&_pre]:my-0 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:text-[13px]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  // Tables: a model-written comparison has no styling of its own.
  //
  // Streamdown already wraps the table in an `overflow-x: auto` div, so a
  // long table scrolls. What it does not prevent is the table being told
  // `width: 100%` and then crushing nine columns into wrapped slivers to
  // honour that. `min-w-full` lets the table take its natural width when
  // that is wider. Headers alone get `nowrap`: a header is a label and reads
  // wrong broken across two lines, while a long body cell must still wrap or
  // one wordy note would stretch the table to the whole page.
  "[&_table]:my-3 [&_table]:min-w-full [&_table]:w-auto [&_table]:border-collapse [&_table]:text-[13.5px]",
  "[&_th]:whitespace-nowrap",
  "[&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-border/60 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top",
  // The language label is the only thing naming a fence, and at 12px muted
  // it read as decoration. Uppercase-tracking is a known tell, so keep the
  // lowercase Streamdown writes and just give it weight it can be read at.
  "[&_[data-streamdown=code-block-header]>span]:text-[11px] [&_[data-streamdown=code-block-header]>span]:font-medium [&_[data-streamdown=code-block-header]>span]:tracking-wide",
  // A pasted screenshot arrives with a viewport-sized intrinsic width; the
  // wrapper is inline, so without a ceiling it pushes the transcript wide.
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  // Diagrams and maths get their own scroll container, never the page's.
  "[&_[data-streamdown=mermaid-block]]:my-3",
  "[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1",
);

export function Markdown({
  children,
  streaming,
  className,
}: {
  children: string;
  streaming?: boolean;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  // Mermaid initialises once per config object identity: a fresh object
  // every render would re-init the parser on every streamed token.
  const mermaidConfig = React.useMemo(
    () => ({ ...(dark ? MERMAID_DARK : MERMAID_LIGHT), securityLevel: "strict" as const, startOnLoad: false }),
    [dark],
  );

  return (
    <Streamdown
      className={cn(PROSE, className)}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      animated
      plugins={markdownPlugins}
      mermaid={{ config: mermaidConfig }}
      linkSafety={{ enabled: true }}
      // Copy/download on code, copy/download on tables. Fullscreen and
      // pan-zoom on diagrams, because a wide chart is unreadable inline.
      controls={{
        code: true,
        table: true,
        mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
      }}
    >
      {children}
    </Streamdown>
  );
}
