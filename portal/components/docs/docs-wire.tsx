import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/docs/code-block";
import { AnthropicMark, OpenAIMark } from "@/components/docs/brand-marks";
import { Section } from "@/components/docs/docs-section";
import {
  anthropicSnippet,
  curlSnippet,
  pythonSnippet,
  typescriptSnippet,
} from "@/components/docs/docs-data";

/**
 * Wire-format sections. OpenAI chat/completions is the primary shape
 * (metering, retries, and budgets are proven on it); Anthropic
 * /v1/messages is fully supported including tool calling and SSE.
 */
export function OpenAISection({ model, base }: { model: string; base: string }) {
  return (
    <Section
      id="openai"
      kicker="Wire format"
      title="OpenAI-compatible chat"
      body={
        <>
          Point any OpenAI SDK at the base URL with your{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">zn-…</code>{" "}
          key. Streaming, tool calling, and the tool-result turn all work —
          verified end to end with agentic CLIs.
        </>
      }
    >
      <CompatCard
        mark={<OpenAIMark className="size-9 text-foreground" />}
        name="OpenAI SDK"
        note="baseURL override only — no code changes beyond the key."
      />
      <Tabs defaultValue="python">
        <TabsList aria-label="OpenAI snippet language">
          <TabsTrigger value="python">Python</TabsTrigger>
          <TabsTrigger value="ts">TypeScript</TabsTrigger>
          <TabsTrigger value="curl">cURL</TabsTrigger>
        </TabsList>
        <TabsContent value="python">
          <CodeBlock language="python" filename="openai.py" code={pythonSnippet(base, model)} />
        </TabsContent>
        <TabsContent value="ts">
          <CodeBlock language="typescript" filename="openai.ts" code={typescriptSnippet(base, model)} />
        </TabsContent>
        <TabsContent value="curl">
          <CodeBlock language="bash" filename="chat.sh" code={curlSnippet(base, model)} />
        </TabsContent>
      </Tabs>
      <EndpointsTable
        rows={[
          ["POST /v1/chat/completions", "Chat, tools, streaming — primary path"],
          ["GET /v1/models", "Returns [fast, smart, …] per your plan"],
          ["POST /v1/responses", "Translated to chat before metering (Codex)"],
        ]}
      />
    </Section>
  );
}

export function AnthropicSection({ model, base }: { model: string; base: string }) {
  return (
    <Section
      id="anthropic"
      kicker="Wire format"
      title="Anthropic-compatible messages"
      body={
        <>
          The same key drives <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">/v1/messages</code>{" "}
          — native upstream support, valid tool-use arguments, SSE framing,
          and the tool-result→answer turn all verified.
        </>
      }
    >
      <CompatCard
        mark={<AnthropicMark className="size-9 text-foreground" />}
        name="Anthropic SDK"
        note="baseURL + key override — messages, tools, streaming."
      />
      <CodeBlock language="typescript" filename="anthropic.ts" code={anthropicSnippet(base, model)} />
      <EndpointsTable
        rows={[
          ["POST /v1/messages", "Native messages incl. tool calling + SSE"],
          ["max_tokens ≥ 1024", "Reasoning models can spend small budgets on thinking"],
        ]}
      />
    </Section>
  );
}

function CompatCard({ mark, name, note }: { mark: React.ReactNode; name: string; note: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
        {mark}
      </span>
      <span>
        <span className="block font-medium">{name}-compatible</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

function EndpointsTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5 font-mono text-[13px] whitespace-nowrap">{k}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
