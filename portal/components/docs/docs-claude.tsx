import { Check } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { ClaudeLogo } from "@/components/docs/vendor-logos";
import { Section } from "@/components/docs/docs-section";
import { StepLabel } from "@/components/docs/docs-codex";
import { CLAUDE_ENV, CLAUDE_SETTINGS } from "@/components/docs/docs-data";

/**
 * Claude Code — Anthropic-format wiring: base URL + token from the
 * environment, model pinned per plan tier.
 */
export function ClaudeCodeSection() {
  return (
    <Section
      id="claude-code"
      kicker="Agent CLI"
      title="Run Claude Code on Zaino"
      body="Claude Code speaks the Anthropic messages shape, served natively. Point it at the Zaino base URL and hand it your zn-… key as the auth token."
    >
      <div className="flex min-w-0 items-center gap-4 border-y border-border py-3">
        <ClaudeLogo />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Claude Code</span>
          <span className="mt-0.5 block font-mono text-xs break-words text-muted-foreground">
            Anthropic-compatible · tool calling verified
          </span>
        </span>
      </div>

      <div className="min-w-0">
        <StepLabel n={1} text="Point Claude Code at the gateway" />
        <CodeBlock language="bash" filename="env.sh" code={CLAUDE_ENV} />
        <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
          Starter drives <code className="font-mono">fast</code> or{" "}
          <code className="font-mono">smart</code>;{" "}
          <code className="font-mono">frontier</code> needs Pro — the gateway
          403s anything outside your plan.
        </p>
      </div>

      <div className="min-w-0">
        <StepLabel n={2} text="Or pin it in settings.json (optional)" />
        <CodeBlock language="json" filename="~/.claude/settings.json" code={CLAUDE_SETTINGS} />
        <p className="mt-2 flex max-w-[68ch] items-start gap-2 text-xs leading-relaxed text-muted-foreground" role="note">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Keep the credential in{" "}
            <code className="font-mono">ANTHROPIC_AUTH_TOKEN</code>, never in the
            JSON file.
          </span>
        </p>
      </div>
    </Section>
  );
}
