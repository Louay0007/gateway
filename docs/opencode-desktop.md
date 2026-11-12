# OpenCode Desktop — client setup

OpenCode Desktop is the official desktop client for the Zaino Gateway.

## Install

Download from the portal download page (`/download`). Binaries are published
for macOS (Apple Silicon), Windows (x64), and Linux (AppImage/.deb/.rpm).

## Sign in

First launch offers "Sign in with Zaino" (device code flow) and a
"Paste device key" fallback. See docs/device-code-flow.md for the protocol.

The device key is stored in the OS keychain. It never appears in config,
logs, renderer state, or audit rows.

## Manual config

The app writes this for you on sign-in: the provider entry, the entitled
aliases only, and the limits the gateway advertises. If you are wiring
OpenCode to Zaino by hand, set the credential and use the same shape:

```bash
export ZAINO_API_KEY='zn-...'
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "zaino": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "name": "Zaino Gateway",
      "settings": {
        "baseURL": "https://api.zaino.soon.it/v1",
        "apiKey": "{env:ZAINO_API_KEY}"
      },
      "models": {
        "fast": {
          "name": "Zaino Fast",
          "family": "zaino",
          "limit": { "context": 1048576, "output": 65536 },
          "capabilities": {
            "tools": true,
            "input": ["text"],
            "output": ["text"],
            "reasoning": { "supported": true }
          }
        }
      }
    }
  },
  "model": "zaino/fast"
}
```

The credential is a reference, never a literal — `{env:ZAINO_API_KEY}`
resolves inside the sidecar from the environment the app passes it. Model
aliases are `fast`, `smart`, `frontier`, `fable`. The app registers only the
aliases the granted key allows, with the limits the gateway advertises.

Two per-model exceptions to the shape above, both load-bearing:

- `frontier` and `fable` set
  `"package": "@opencode/ai/providers/anthropic-compatible"` and talk to
  `/v1/messages`. `/v1/chat/completions` strips image parts from the body;
  `/v1/messages` forwards it verbatim, which is what makes attachments work.
- `fast` and `smart` keep the OpenAI-compatible transport above.

## Endpoints

- Gateway (OpenAI-compatible): `https://api.zaino.soon.it/v1`
- Portal: `https://zaino.soon.it`

## Notes

- The credential is sent verbatim as `Authorization: Bearer zn-…`. Do not
  rewrite it to `sk-…` on the client; the auth edge does that.
- The catalog (`GET /v1/models`) advertises each alias with
  `max_input_tokens` (1048576) and `max_output_tokens` (65536), which the app
  sizes its context window from. Verified against the live gateway.
- **TOKENS are the only limit**, and the server enforces them. Each plan has
  a monthly blended-token budget split across the aliases it serves (50M per
  month on every shipped plan, 0038), counted over the subscription period.
  Blended = fresh input + output + cache writes (5m and 1h) + cache reads.
- The enforcement is an ALLOWLIST, not a budget: the portal pushes the
  still-affordable alias set onto the LiteLLM team and every key, so a spent
  alias is refused with 403. rpm, tpm and concurrency are never pushed.
- Prompts are NOT a quota. `prompt_count` is collected for analytics only.
- The client gate (`/api/device/usage`) is a courtesy that refuses a spent
  alias before spending tokens on it. The portal is the judge; a client that
  skips the gate is refused by the wall, not by the gate.
- Plan-gated: Starter and Trial get `fast` + `smart`; Pro gets `smart` +
  `frontier` + `fable`. A user must never see an alias their plan excludes.
