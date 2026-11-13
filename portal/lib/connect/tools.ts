/**
 * /connect — the tool catalogue and its snippet generator.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The snippets on /connect and the snippets
 * on /docs must be the same strings. Hand-writing them twice is how a docs
 * page ends up telling a developer to use a base URL the gateway no longer
 * serves. Everything here builds on the primitives in
 * `components/docs/docs-data.ts`, so there is one definition of the base URL,
 * the auth header and the request body.
 *
 * EVERY SNIPPET ENDS WITH A TEST THAT PROVES A 200. That is the opencode
 * pattern and it matters more than the snippet itself: a developer who can
 * copy one line and see `200` has onboarded. One who copies a snippet and
 * gets a 401 has to debug us before they can debug their own code.
 *
 * ALIAS-ONLY. No snippet names an upstream model.
 */

import { PUBLIC_BASE_URL, curlSnippet } from "@/components/docs/docs-data";

export type ToolId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "zed"
  | "continue"
  | "aider"
  | "openai-python"
  | "openai-node"
  | "anthropic-python"
  | "langchain"
  | "llamaindex"
  | "n8n"
  | "open-webui"
  | "curl";

export type ToolGroup = "Coding agents" | "SDKs" | "Frameworks & apps" | "Raw";

export interface Tool {
  id: ToolId;
  name: string;
  group: ToolGroup;
  /** One line: what this tool is, so nobody picks the wrong row. */
  blurb: string;
}

export const TOOLS: Tool[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    group: "Coding agents",
    blurb: "Anthropic's terminal agent — verified against the Zaino edge.",
  },
  {
    id: "codex",
    name: "Codex",
    group: "Coding agents",
    blurb: "OpenAI's CLI. Needs the Responses wire format, which we translate.",
  },
  {
    id: "cursor",
    name: "Cursor",
    group: "Coding agents",
    blurb: "OpenAI-compatible custom model provider.",
  },
  {
    id: "zed",
    name: "Zed",
    group: "Coding agents",
    blurb: "Editor with an OpenAI-compatible assistant endpoint.",
  },
  {
    id: "continue",
    name: "Continue",
    group: "Coding agents",
    blurb: "VS Code / JetBrains assistant, config in YAML.",
  },
  {
    id: "aider",
    name: "Aider",
    group: "Coding agents",
    blurb: "Git-aware pair programmer, OpenAI-compatible.",
  },
  {
    id: "openai-python",
    name: "OpenAI SDK · Python",
    group: "SDKs",
    blurb: "The official SDK, pointed at our base URL.",
  },
  {
    id: "openai-node",
    name: "OpenAI SDK · Node",
    group: "SDKs",
    blurb: "The official SDK for TypeScript / JavaScript.",
  },
  {
    id: "anthropic-python",
    name: "Anthropic SDK · Python",
    group: "SDKs",
    blurb: "Native /v1/messages — the format that carries images as pixels.",
  },
  {
    id: "langchain",
    name: "LangChain",
    group: "Frameworks & apps",
    blurb: "ChatOpenAI with a custom base URL.",
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    group: "Frameworks & apps",
    blurb: "OpenAILike with api_base and is_chat_model.",
  },
  {
    id: "n8n",
    name: "n8n",
    group: "Frameworks & apps",
    blurb: "OpenAI node with a Base URL override.",
  },
  {
    id: "open-webui",
    name: "Open WebUI",
    group: "Frameworks & apps",
    blurb: "Self-hosted chat UI, OpenAI connection settings.",
  },
  {
    id: "curl",
    name: "curl",
    group: "Raw",
    blurb: "No SDK at all — one HTTP request.",
  },
];

export const TOOL_GROUPS: ToolGroup[] = [
  "Coding agents",
  "SDKs",
  "Frameworks & apps",
  "Raw",
];

/** What a developer pastes. Code first, prose second. */
export interface ToolSnippet {
  /** Language for the code block highlighter. */
  language: "bash" | "python" | "typescript" | "json" | "yaml" | "toml";
  /** Where this block goes, e.g. "~/.claude/settings.json". */
  filename: string;
  code: string;
  /** Optional second block (e.g. the YAML beside the CLI command). */
  also?: { language: ToolSnippet["language"]; filename: string; code: string };
  /** The one-line command that proves it works. */
  test: string;
  /** Things that bite, written next to the snippet. */
  trap?: string;
}

/**
 * Build the snippet for a tool, for a given tier.
 *
 * `key` is the customer's own `zn-` value. It is interpolated raw so the
 * clipboard is directly pasteable; the page shows a warning that the block
 * now contains a secret.
 */
export function snippetFor(tool: ToolId, model: string, key: string): ToolSnippet {
  const k = key || "zn-…";
  const base = PUBLIC_BASE_URL; // https://api.zaino.soon.it/v1
  // The Anthropic wire format is served at the origin, without /v1.
  const anthropicBase = base.replace(/\/v1\/?$/, "");

  const test = `curl -sS ${base}/chat/completions \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"reply with: ok"}],"max_tokens":8}'`;

  switch (tool) {
    case "claude-code":
      return {
        language: "bash",
        filename: "terminal",
        code: `export ANTHROPIC_BASE_URL="${anthropicBase}"
export ANTHROPIC_AUTH_TOKEN="${k}"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_MODEL="${model}"`,
        test: `curl -sS ${anthropicBase}/v1/messages \\
  -H "x-api-key: ${k}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","max_tokens":8,"messages":[{"role":"user","content":"reply with: ok"}]}'`,
        trap:
          'ANTHROPIC_API_KEY must be set to an empty string. If it still holds a value, Claude Code sends it instead of the auth token and you get a 401 that has nothing to do with your key.',
      };

    case "codex":
      return {
        language: "toml",
        filename: "~/.codex/config.toml",
        code: `[model_providers.zaino]
base_url = "${base}"
env_key = "ZAINO_API_KEY"
wire_api = "responses"

[models.${model}]
model_provider = "zaino"`,
        also: {
          language: "bash",
          filename: "terminal",
          code: `export ZAINO_API_KEY='${k}'

# The model override is required — without it Codex sends its global
# default, which the gateway correctly rejects with a 403.
codex -c model_provider=zaino -c model=${model}`,
        },
        test,
        trap:
          "Codex speaks only the Responses API. We translate it to chat/completions inside the gateway so metering stays on the priced shape — set wire_api = \"responses\", not \"chat\".",
      };

    case "cursor":
      return {
        language: "bash",
        filename: "Cursor → Settings → Models",
        code: `# Settings → Models → OpenAI API key
# Turn on "Override OpenAI Base URL" and paste:
${base}

# Then add a custom model named exactly:
${model}`,
        test,
        trap:
          "Cursor sends its own model names first. Add the alias above as a custom model, or every request will name a model your plan does not include.",
      };

    case "zed":
      return {
        language: "json",
        filename: "~/.config/zed/settings.json",
        code: `{
  "language_models": {
    "openai": {
      "api_url": "${base}",
      "available_models": [
        { "name": "${model}", "max_tokens": 65536 }
      ]
    }
  }
}`,
        test,
        trap: "Zed reads the API key from the OpenAI provider field, not from this file.",
      };

    case "continue":
      return {
        language: "yaml",
        filename: "~/.continue/config.yaml",
        code: `models:
  - name: Zaino ${model}
    provider: openai
    model: ${model}
    apiBase: ${base}
    apiKey: ${k}`,
        test,
      };

    case "aider":
      return {
        language: "bash",
        filename: "terminal",
        code: `export OPENAI_API_BASE="${base}"
export OPENAI_API_KEY="${k}"

aider --model openai/${model}`,
        test,
      };

    case "openai-python":
      return {
        language: "python",
        filename: "main.py",
        code: `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="${k}",
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "reply with: ok"}],
)
print(resp.choices[0].message.content)`,
        test,
      };

    case "openai-node":
      return {
        language: "typescript",
        filename: "main.ts",
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: "${k}",
});

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "reply with: ok" }],
});
console.log(resp.choices[0]?.message?.content);`,
        test,
      };

    case "anthropic-python":
      return {
        language: "python",
        filename: "main.py",
        code: `from anthropic import Anthropic

client = Anthropic(
    base_url="${anthropicBase}",
    api_key="${k}",
)

msg = client.messages.create(
    model="${model}",
    max_tokens=64,
    messages=[{"role": "user", "content": "reply with: ok"}],
)
print(msg.content[0].text)`,
        // Must test the SAME endpoint this snippet configures. The shared
        // `test` curls chat/completions, which would prove the OpenAI path
        // works while leaving the Anthropic path — the one this block sets
        // up — unverified.
        test: `curl -sS ${anthropicBase}/v1/messages \\
  -H "x-api-key: ${k}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","max_tokens":8,"messages":[{"role":"user","content":"reply with: ok"}]}'`,
        trap:
          "Use the /v1/messages format for images — on chat/completions the pixels are stripped before the model sees them.",
      };

    case "langchain":
      return {
        language: "python",
        filename: "main.py",
        code: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="${model}",
    base_url="${base}",
    api_key="${k}",
)
print(llm.invoke("reply with: ok").content)`,
        test,
      };

    case "llamaindex":
      return {
        language: "python",
        filename: "main.py",
        code: `from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    model="${model}",
    api_base="${base}",
    api_key="${k}",
    is_chat_model=True,
)
print(llm.complete("reply with: ok"))`,
        test,
      };

    case "n8n":
      return {
        language: "bash",
        filename: "n8n → OpenAI node",
        code: `# Credential: OpenAI API
#   API Key   → ${k}
#   Base URL  → ${base}
#
# In the OpenAI node, set Model to: ${model}`,
        test,
      };

    case "open-webui":
      return {
        language: "bash",
        filename: "Open WebUI → Admin → Connections",
        code: `# Admin Settings → Connections → OpenAI API
#   API Base URL → ${base}
#   API Key      → ${k}
#
# Then pick "${model}" from the model list — it is read live from
# GET /v1/models, so a plan change appears without a restart.`,
        test,
      };

    case "curl":
    default:
      return {
        language: "bash",
        filename: "request.sh",
        code: curlSnippet(base, model),
        test,
      };
  }
}

/**
 * A pasteable block with the key already substituted.
 *
 * Returns the block and whether it contains a real credential, so the UI
 * can warn before a customer pastes a live secret into a public gist.
 */
export function substituteKey(code: string, key: string): { code: string; hasSecret: boolean } {
  const hasSecret = Boolean(key && key.trim().length > 0);
  return { code, hasSecret };
}
