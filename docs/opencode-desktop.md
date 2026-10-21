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

## Manual config (Tier 1)

If you are wiring OpenCode to Zaino without the device flow, set:

```bash
export ZAINO_API_KEY='zn-...'
```

and use this provider block in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "zaino": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Zaino Gateway",
      "options": {
        "baseURL": "https://api.zaino.soon.it/v1",
        "apiKey": "{env:ZAINO_API_KEY}"
      },
      "models": {
        "fast":   { "name": "Zaino Fast",   "limit": { "context": 262144, "output": 32768 }, "tool_call": true, "reasoning": true },
        "smart":  { "name": "Zaino Smart",  "limit": { "context": 262144, "output": 32768 }, "tool_call": true, "reasoning": true },
        "frontier": { "name": "Zaino Frontier", "limit": { "context": 262144, "output": 32768 }, "tool_call": true, "reasoning": true }
      }
    }
  },
  "model": "zaino/fast"
}
```

Model aliases are `fast`, `smart`, `frontier` only. `frontier` requires a Pro plan.

## Endpoints

- Gateway (OpenAI-compatible): `https://api.zaino.soon.it/v1`
- Portal: `https://portal.zaino.soon.it`

## Notes

- The credential is sent verbatim as `Authorization: Bearer zn-…`. Do not
  rewrite it to `sk-…` on the client; the auth edge does that.
- `/v1/responses` is owned by the edge shim; prefer it for streaming agents.
- Plan-gated: Starter users must not see `frontier` in the picker.
