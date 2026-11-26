"use client";

import * as React from "react";
import { FlaskConical, Globe } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/docs/code-block";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/docs/docs-section";
import {
  PUBLIC_BASE_URL,
  curlSnippet,
  pythonSnippet,
  responsesSnippet,
  typescriptSnippet,
} from "@/components/docs/docs-data";

/**
 * Quickstart — the first-call section. A live model picker + base-URL toggle
 * rewrites every snippet below it, so the copy-paste a visitor takes matches
 * the tier they actually intend to call.
 *
 * LAYOUT. Three steps, left to right on a wide screen, numbered in the margin
 * the same way the sections are. The old version wrapped steps 1 and 2 in two
 * equal cards and step 3 in a third — three borders around what is one
 * sequence, which made the reader hunt for the order. Steps are read in order
 * or not at all, so the number carries the structure and no container is
 * needed. The step 2 controls stay grouped because they are one decision.
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
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-7 lg:grid-cols-2">
        {/* STEP 1 — the credential. Narrow on purpose: it is one line. */}
        <div className="min-w-0">
          <StepLabel n={1} text="Credential" />
          <CodeBlock
            className="mt-2.5"
            language="bash"
            filename="terminal"
            code={`export ZAINO_API_KEY='zn-…'  # shown once, at creation`}
          />
        </div>

        {/* STEP 2 — the two choices that rewrite every snippet below. */}
        <div className="min-w-0">
          <StepLabel n={2} text="Tier & endpoint" />
          <div className="mt-2.5" role="group" aria-label="Model tier">
            {/* A segmented control, not four separate chips: these are mutually
                exclusive choices, and the shape should say so. */}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              {["fast", "smart", "frontier", "fable"].map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="toggle"
                  size="xs"
                  onClick={() => setModel(m)}
                  aria-pressed={model === m}
                  className="rounded-md px-2.5 font-mono text-xs aria-pressed:shadow-sm"
                >
                  {m}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Base URL">
            <BaseToggle
              active={base === PUBLIC_BASE_URL}
              onClick={() => setBase(PUBLIC_BASE_URL)}
              icon={<Globe className="size-3.5" />}
              label="Production"
            />
            <code className="font-mono text-xs break-all text-muted-foreground">{base}</code>
          </div>
        </div>

        {/* STEP 3 — send it. Full column: this is the payload the page exists
            to deliver, and it is the one thing that should be able to be wide. */}
        <div className="min-w-0 lg:col-span-2">
          <StepLabel n={3} text="Send it" detail={model} />
          <Tabs defaultValue="curl" className="mt-2.5">
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
      </div>
    </Section>
  );
}

/**
 * A step's label.
 *
 * The number is a mono numeral with a hairline leading into the text rather
 * than a filled circle: a filled `bg-primary` disc beside every step makes the
 * page's most-repeated element its loudest one, which inverts the hierarchy —
 * the code beneath it is what the reader came for.
 */
function StepLabel({ n, text, detail }: { n: number; text: string; detail?: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm">
      <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
        {String(n).padStart(2, "0")}
      </span>
      <span className="font-medium text-foreground">{text}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {/* The tier is set off by its own label, not appended to the sentence.
          "03 Send it fast" reads as a typo when the tier is `fast`; "model:
          fast" reads as the parameter it is. */}
      {detail ? (
        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          model
          <code className="font-mono text-xs font-medium text-foreground">{detail}</code>
        </span>
      ) : null}
    </p>
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
    <Button
      type="button"
      variant="toggle"
      size="xs"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-3 py-1.5 text-xs font-medium"
    >
      {icon}
      {label}
    </Button>
  );
}
