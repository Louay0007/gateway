import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/docs/code-block";
import { AnthropicLogo, OpenAILogo } from "@/components/docs/vendor-logos";
import { Section } from "@/components/docs/docs-section";
import {
  anthropicSnippet,
  curlSnippet,
  pythonSnippet,
  typescriptSnippet,
} from "@/components/docs/docs-data";

/**
 * Wire-format sections. OpenAI chat/completions is the primary shape
 * (metering, retries, and budgets are proven on it); Anthropic /v1/messages is
 * fully supported including tool calling and SSE.
 *
 * LAYOUT. The compatibility statement used to be a second border+card sitting
 * directly under the section's own card, i.e. a card inside a card by any
 * reading. It is now the row it always was: the vendor mark, the claim, and the
 * descriptor on one line, separated from the snippet by the same hairline the
 * rest of the page uses.
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
      <CompatRow
        mark={<OpenAILogo />}
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
          The same key drives{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">/v1/messages</code>{" "}
          — native upstream support, valid tool-use arguments, SSE framing, and
          the tool-result→answer turn all verified.
        </>
      }
    >
      <CompatRow
        mark={<AnthropicLogo />}
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

/**
 * The compatibility row.
 *
 * It keeps the vendor mark at a fixed tile size — the marks are official
 * artwork at wildly different aspect ratios, and letting each one size itself
 * made the two rows disagree by 20px — but drops the container: a hairline
 * above and below groups it with the snippet it introduces.
 */
function CompatRow({ mark, name, note }: { mark: React.ReactNode; name: string; note: string }) {
  return (
    <div className="flex min-w-0 items-center gap-4 border-y border-border py-3">
      {mark}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{name}-compatible</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted-foreground">
          {note}
        </span>
      </span>
    </div>
  );
}

/**
 * Endpoints — two columns, no cell borders.
 *
 * The old version boxed this in a rounded border and ruled every row, giving a
 * two-row table the same visual weight as the eight-row plan table further
 * down the page. Method and path are one column because they are read as one
 * token; the description is the only thing that wraps.
 */
function EndpointsTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full min-w-0 border-collapse text-left text-sm">
      <caption className="sr-only">Endpoint and what it answers</caption>
      <tbody>
        {rows.map(([endpoint, meaning]) => (
          <tr key={endpoint} className="border-b border-border last:border-0">
            <th scope="row" className="w-0 py-2.5 pr-6 align-top whitespace-nowrap">
              <code className="font-mono text-[13px] text-foreground">{endpoint}</code>
            </th>
            <td className="py-2.5 align-top text-[0.8125rem] leading-relaxed text-muted-foreground">
              {meaning}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
