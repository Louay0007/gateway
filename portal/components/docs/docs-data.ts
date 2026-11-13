/**
 * Docs data — the single source of truth for the /docs surface.
 *
 * PRODUCTION values only. Every snippet defaults to the public edge so a
 * copy-paste from the docs works from any machine.
 *
 * INVARIANT: only the four aliases (fast / smart / frontier / fable) appear
 * here. No upstream model name is rendered, exported, or embedded in any
 * snippet — the alias IS the product (HANDOFF §1). The `poweredBy` field is
 * a display label that must stay an alias-family name ("Zaino Haiku 5.5"),
 * never a vendor's model id.
 *
 * EVERY NUMBER HERE IS MIRRORED FROM THE DATABASE. If a plan's models or a
 * rate changes, this file changes with it — `portal/tests/docs-truth.test.ts`
 * fails when `TIERS[].plans` or `TIERS[].alias` disagree with the live plan
 * table, because a docs page that contradicts `GET /v1/models` is how a
 * developer decides not to trust the meter.
 */
export const PUBLIC_BASE_URL = "https://api.zaino.soon.it/v1";

export const CONTEXT_WINDOW = 1048576;
export const MAX_OUTPUT_TOKENS = 65536;

/**
 * The token allowance model (migration 0039): ONE SHARED POOL per plan.
 *
 * `poolTokens` is the plan's monthly total. The customer spends it on any
 * model the plan unlocks, in any proportion — 30M fast + 20M smart, 10M +
 * 40M, or all 50M on one alias. There is no per-model ceiling, and the docs
 * must never imply one: a developer who reads "25M fast / 25M smart" will
 * conclude the split is enforced and stop at 25M.
 */
export const POOL_PLANS: {
  code: string;
  label: string;
  tokens: number;
  tokensLabel: string;
  priceUsdCents: number;
  priceTndMillimes: number;
  models: string[];
  maxKeys: number;
}[] = [
  {
    code: "starter",
    label: "Starter",
    tokens: 50_000_000,
    tokensLabel: "50M",
    priceUsdCents: 1500,
    priceTndMillimes: 50000,
    models: ["fast", "smart"],
    maxKeys: 3,
  },
  {
    code: "pro",
    label: "Pro",
    tokens: 50_000_000,
    tokensLabel: "50M",
    priceUsdCents: 3000,
    priceTndMillimes: 90000,
    models: ["smart", "frontier", "fable"],
    maxKeys: 15,
  },
];

/** Trial is code-gated, 3 days, and 1M total — see ZAINO-FREE-NOV26. */
export const TRIAL = { days: 3, tokens: 1_000_000, tokensLabel: "1M", models: ["fast", "smart"] };

/** What the ceiling looks like, stated once so every section can reuse it. */
export const POOL_NOTE =
  "One shared pool per plan. Spend it on any model your plan includes, in any proportion — 30M on one and 20M on another, or all of it on a single model. When the pool is spent, every model on that plan pauses until the next period.";

export type Tier = {
  alias: string;
  poweredBy: string;
  tagline: string;
  inputPerMtok: string;
  outputPerMtok: string;
  cacheReadPerMtok: string;
  plans: string;
  bestFor: string[];
  badge: string;
};

export const TIERS: Tier[] = [
  {
    alias: "fast",
    poweredBy: "Zaino Haiku 5.5",
    tagline: "High-volume work — drafts, classification, bulk transforms.",
    inputPerMtok: "$1.00",
    outputPerMtok: "$5.00",
    cacheReadPerMtok: "$0.10",
    plans: "Starter · Pro",
    bestFor: ["Chat & copilots", "Bulk jobs", "First drafts"],
    badge: "Cheapest",
  },
  {
    alias: "smart",
    poweredBy: "Zaino Sonnet 5.5",
    tagline: "Everyday balanced tier — the default for most integrations.",
    inputPerMtok: "$3.00",
    outputPerMtok: "$15.00",
    cacheReadPerMtok: "$0.30",
    plans: "Starter · Pro",
    bestFor: ["Agents", "Tool calling", "Support bots"],
    badge: "Most used",
  },
  {
    alias: "frontier",
    poweredBy: "Zaino Opus 5.5",
    tagline: "Mythos-class reasoning for the hardest long-running workloads.",
    inputPerMtok: "$15.00",
    outputPerMtok: "$75.00",
    cacheReadPerMtok: "$1.50",
    plans: "Pro only",
    bestFor: ["Deep reasoning", "Multi-step agents", "Hard tasks"],
    badge: "Pro",
  },
  {
    alias: "fable",
    poweredBy: "Zaino Fable 5.1",
    tagline: "Longest-horizon reasoning — whole-task runs that other tiers drop.",
    inputPerMtok: "$15.00",
    outputPerMtok: "$75.00",
    cacheReadPerMtok: "$1.50",
    plans: "Pro only",
    bestFor: ["Whole-task runs", "Long agents", "Deepest reasoning"],
    badge: "New",
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
model_max_output_tokens = ${MAX_OUTPUT_TOKENS}

[models.fable]
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
