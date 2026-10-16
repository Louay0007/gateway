"use client";

import * as React from "react";
import { FlaskConical, Globe } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/docs/code-block";
import { Section } from "@/components/docs/docs-section";
import {
  PUBLIC_BASE_URL,
  curlSnippet,
  pythonSnippet,
  responsesSnippet,
  typescriptSnippet,
} from "@/components/docs/docs-data";

/**
 * Quickstart — the first-call section. A live model picker + base-URL
 * toggle rewrites every snippet below it, so the copy-paste a visitor
 * takes matches the tier they actually intend to call.
 */
export function Quickstart({
  model,
  setModel,
  base,
  setBase,
}: {
  model: string;
  setModel: (m: string) => void;
  base: string;
  setBase: (b: string) => void;
}) {
  return (
    <Section
      id="quickstart"
      kicker="Quickstart"
      title="Your first request"
      body="Set one environment variable, pick a tier, paste the snippet. Auth is a Bearer token — your zn-… key, shown once when minted."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            1 · Credential
          </p>
          <CodeBlock
            className="mt-3"
            language="bash"
            filename="terminal"
            code={`export ZAINO_API_KEY='zn-…  # paste the value shown once at creation'`}
          />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            2 · Tier & endpoint
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Model tier">
            {["fast", "smart", "frontier"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                aria-pressed={model === m}
                className={
                  model === m
                    ? "rounded-full bg-primary px-4 py-1.5 font-mono text-sm font-medium text-primary-foreground"
                    : "rounded-full border border-border px-4 py-1.5 font-mono text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {m}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Base URL">
            <BaseToggle active={base === PUBLIC_BASE_URL} onClick={() => setBase(PUBLIC_BASE_URL)} icon={<Globe className="size-3.5" />} label="Production" />
          </div>
          <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{base}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          3 · Send it — model: <span className="font-mono text-foreground">{model}</span>
        </p>
        <Tabs defaultValue="curl" className="mt-3">
          <TabsList aria-label="Snippet language">
            <TabsTrigger value="curl">cURL</TabsTrigger>
            <TabsTrigger value="python">Python</TabsTrigger>
            <TabsTrigger value="ts">TypeScript</TabsTrigger>
            <TabsTrigger value="responses">Responses</TabsTrigger>
          </TabsList>
          <TabsContent value="curl">
            <CodeBlock language="bash" filename="request.sh" code={curlSnippet(base, model)} />
          </TabsContent>
          <TabsContent value="python">
            <CodeBlock language="python" filename="quickstart.py" code={pythonSnippet(base, model)} />
          </TabsContent>
          <TabsContent value="ts">
            <CodeBlock language="typescript" filename="quickstart.ts" code={typescriptSnippet(base, model)} />
          </TabsContent>
          <TabsContent value="responses">
            <CodeBlock language="bash" filename="responses.sh" code={responsesSnippet(base, model)} />
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The Responses endpoint is translated to chat/completions inside
              the gateway so metering stays on the priced shape.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </Section>
  );
}

function BaseToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          : "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      }
    >
      {icon}
      {label}
    </button>
  );
}
