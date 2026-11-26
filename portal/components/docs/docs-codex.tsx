import { AlertTriangle, Check } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { OpenAILogo } from "@/components/docs/vendor-logos";
import { Section } from "@/components/docs/docs-section";
import { CODEX_RUN, CODEX_TOML, CONTEXT_WINDOW, MAX_OUTPUT_TOKENS } from "@/components/docs/docs-data";

/**
 * Codex — the 0.156 Responses-only CLI. The gateway translates /v1/responses
 * to chat before metering; the model override is REQUIRED.
 *
 * LAYOUT. The steps used to be numbered in filled `bg-primary` discs — the
 * loudest element on a page where the code is the point — and the capability
 * list was a third bordered card. The disc is now a margin numeral matching
 * every other numbered thing on the page, and the list is a plain set of rows:
 * three facts do not need a box, and a box here read as a third snippet.
 */
export function CodexSection() {
  return (
    <Section
      id="codex"
      kicker="Agent CLI"
      title="Run Codex on Zaino"
      body="codex-cli 0.156 speaks the Responses API exclusively. The gateway translates it to chat before metering — reasoning deltas stay out of the answer text, streams always terminate, error statuses pass through."
    >
      <div className="flex min-w-0 items-center gap-4 border-y border-border py-3">
        <OpenAILogo />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Codex</span>
          <span className="mt-0.5 block font-mono text-xs break-words text-muted-foreground">
            0.156.1 verified · wire_api = responses · OpenAI CLI
          </span>
        </span>
      </div>

      <div className="min-w-0">
        <StepLabel n={1} text="Declare the provider and the tiers" />
        <CodeBlock language="toml" filename="~/.codex/config.toml" code={CODEX_TOML} />
        <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
          Without <code className="font-mono">[models.*]</code> Codex warns
          “Model metadata not found”. Context {CONTEXT_WINDOW.toLocaleString()} ·
          max output {MAX_OUTPUT_TOKENS.toLocaleString()}.
        </p>
      </div>

      <div className="min-w-0">
        <StepLabel n={2} text="Export the key and run with the override" />
        <CodeBlock language="bash" filename="run-codex.sh" code={CODEX_RUN} />
        <p className="mt-2 flex max-w-[68ch] items-start gap-2 text-xs leading-relaxed text-foreground" role="note">
          {/*
            `text-warning`, NOT `text-warning-foreground`, WAS WRONG HERE.
            --warning is a FILL colour (oklch 0.72 0.17 70 in light mode): fine
            as a 10% tint behind text, but as text on that same tint it measures
            2.34:1 — below the 4.5:1 body floor AND below the 3:1 icon floor.
            The amber now stays on the icon, and the sentence is ink.
          */}
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            <code className="font-mono">-c model=fast</code> is required — without
            it Codex sends its global default, rejected with 403.
          </span>
        </p>
      </div>

      {/* Three capabilities, as rows. `divide-y` rather than a bordered card:
          the list is one object, and its own rules say so without adding a
          container that competes with the snippets above it. */}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] divide-y divide-border border-y border-border text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {["Prompt → tool call → answer", "Multi-step file read/write/exec", "Use max_output ≥ 1024"].map((item) => (
          <li key={item} className="flex items-start gap-2.5 px-0 py-3 text-[0.8125rem] sm:px-4">
            <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A step's label — margin numeral, then the instruction.
 *
 * Shared with the Claude Code section. Mono and small: the reader is looking
 * for the code block, and the label is the signpost, not the destination.
 */
export function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <p className="mb-2.5 flex items-center gap-2.5 text-sm">
      <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
        {String(n).padStart(2, "0")}
      </span>
      <span className="font-medium text-foreground">{text}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </p>
  );
}
