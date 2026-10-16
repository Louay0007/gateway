/**
 * Docs data — the single source of truth for the /docs surface.
 *
 * PRODUCTION values only. Every snippet defaults to the public edge so a
 * copy-paste from the docs works from any machine.
 *
 * INVARIANT: only the three aliases (fast / smart / frontier) appear here.
 * No upstream model name is rendered, exported, or embedded in any snippet
 * — the alias IS the product (HANDOFF §1).
 */
export const PUBLIC_BASE_URL = "https://api.15-224-52-176.sslip.io/v1";

export const CONTEXT_WINDOW = 262144;
export const MAX_OUTPUT_TOKENS = 32768;

export type Tier = {
  alias: string;
  tagline: string;
  inputPerMtok: string;
  outputPerMtok: string;
  plans: string;
  bestFor: string[];
  badge: string;
};

export const TIERS: Tier[] = [
  {
    alias: "fast",
    tagline: "High-volume work — drafts, classification, bulk transforms.",
    inputPerMtok: "$0.15",
    outputPerMtok: "$0.60",
    plans: "Starter · Pro",
    bestFor: ["Chat & copilots", "Bulk jobs", "First drafts"],
    badge: "Cheapest",
  },
  {
    alias: "smart",
    tagline: "Everyday balanced tier — the default for most integrations.",
    inputPerMtok: "$0.30",
    outputPerMtok: "$1.20",
    plans: "Starter · Pro",
    bestFor: ["Agents", "Tool calling", "Support bots"],
    badge: "Most used",
  },
  {
    alias: "frontier",
    tagline: "Highest-priced tier for the hardest reasoning workloads.",
    inputPerMtok: "$0.60",
    outputPerMtok: "$2.40",
    plans: "Pro only",
    bestFor: ["Deep reasoning", "Multi-step agents", "Hard tasks"],
    badge: "Pro",
  },
];

export function curlSnippet(base: string, model: string): string {
  return `curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ZAINO_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [
      { "role": "user", "content": "Hello from Zaino — reply in one sentence." }
    ]
  }'`;
}

export function pythonSnippet(base: string, model: string): string {
  return `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="zn-...",  # or os.environ["ZAINO_API_KEY"]
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello from Zaino!"}],
)
print(resp.choices[0].message.content)`;
}

export function typescriptSnippet(base: string, model: string): string {
  return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: process.env.ZAINO_API_KEY, // zn-…
});

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello from Zaino!" }],
});
console.log(resp.choices[0]?.message?.content);`;
}

export function anthropicSnippet(base: string, model: string): string {
  return `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${base}",
  apiKey: process.env.ZAINO_API_KEY, // zn-…
});

const msg = await client.messages.create({
  model: "${model}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello from Zaino!" }],
});
console.log(msg);`;
}

export function responsesSnippet(base: string, model: string): string {
  return `curl ${base}/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ZAINO_API_KEY" \\
  -d '{
    "model": "${model}",
    "input": "Hello from Zaino — reply in one sentence."
  }'`;
}

export const CODEX_TOML = `# ~/.codex/config.toml — Zaino as a Codex provider.
# Verified with codex-cli 0.156.1 (Responses API only).

[model_providers.zaino]
base_url = "${PUBLIC_BASE_URL}"
env_key = "ZAINO_API_KEY"
wire_api = "responses"

[models.fast]
model_provider = "zaino"
model_context_window = ${CONTEXT_WINDOW}
model_max_output_tokens = ${MAX_OUTPUT_TOKENS}

[models.smart]
model_provider = "zaino"
model_context_window = ${CONTEXT_WINDOW}
model_max_output_tokens = ${MAX_OUTPUT_TOKENS}

[models.frontier]
model_provider = "zaino"
model_context_window = ${CONTEXT_WINDOW}
model_max_output_tokens = ${MAX_OUTPUT_TOKENS}`;

export const CODEX_RUN = `export ZAINO_API_KEY='zn-…'

# The model override is REQUIRED — without it Codex sends its
# global default, which the gateway correctly rejects with 403.
codex -c model_provider=zaino -c model=fast`;

export const CLAUDE_ENV = `export ANTHROPIC_BASE_URL="${PUBLIC_BASE_URL}"
export ANTHROPIC_AUTH_TOKEN="zn-…"

# Pick the tier Claude Code should drive (Starter: fast | smart).
export ANTHROPIC_MODEL="fast"`;

export const CLAUDE_SETTINGS = `{
  // ~/.claude/settings.json — point Claude Code at Zaino.
  // Credentials come from the environment (ANTHROPIC_AUTH_TOKEN),
  // never from this file.
  "env": {
    "ANTHROPIC_BASE_URL": "${PUBLIC_BASE_URL}",
    "ANTHROPIC_MODEL": "fast"
  }
}`;
