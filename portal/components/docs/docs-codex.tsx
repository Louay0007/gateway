import { AlertTriangle, Check } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { OpenAILogo } from "@/components/docs/vendor-logos";
import { Section } from "@/components/docs/docs-section";
import { CODEX_RUN, CODEX_TOML, CONTEXT_WINDOW, MAX_OUTPUT_TOKENS } from "@/components/docs/docs-data";

/**
 * Codex — the 0.156 Responses-only CLI. The gateway translates
 * /v1/responses to chat before metering; the model override is REQUIRED.
 */
export function CodexSection() {
  return (
    <Section
      id="codex"
      kicker="Agent CLI"
      title="Run Codex on Zaino"
      body="codex-cli 0.156 speaks the Responses API exclusively. The gateway translates it to chat before metering — reasoning deltas stay out of the answer text, streams always terminate, error statuses pass through."
    >
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <OpenAILogo />
        <span>
          <span className="block font-medium">Codex</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
            0.156.1 verified · wire_api = responses · OpenAI CLI
          </span>
        </span>
      </div>
      <div>
        <StepN n={1} text="Declare the provider and the three tiers" />
        <CodeBlock language="toml" filename="~/.codex/config.toml" code={CODEX_TOML} />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Without <code className="font-mono">[models.*]</code> Codex warns
          “Model metadata not found”. Context {CONTEXT_WINDOW.toLocaleString()} ·
          max output {MAX_OUTPUT_TOKENS.toLocaleString()}.
        </p>
      </div>
      <div>
        <StepN n={2} text="Export the key and run with the override" />
        <CodeBlock language="bash" filename="run-codex.sh" code={CODEX_RUN} />
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <code className="font-mono">-c model=fast</code> is required —
            without it Codex sends its global default, rejected with 403.
          </span>
        </p>
      </div>
      <ul className="grid gap-2 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-3">
        {["Prompt → tool call → answer", "Multi-step file read/write/exec", "Use max_output ≥ 1024"].map((t) => (
          <li key={t} className="flex items-start gap-2 text-[13px]">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function StepN({ n, text }: { n: number; text: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
        {n}
      </span>
      {text}
    </p>
  );
}
