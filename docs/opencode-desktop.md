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
aliases are `fast`, `smart`, `frontier` only. The app registers only the
aliases the granted key allows, with the limits the gateway advertises.

## Endpoints

- Gateway (OpenAI-compatible): `https://api.zaino.soon.it/v1`
- Portal: `https://zaino.soon.it`

## Notes

- The credential is sent verbatim as `Authorization: Bearer zn-…`. Do not
  rewrite it to `sk-…` on the client; the auth edge does that.
- The catalog (`GET /v1/models`) advertises each alias with the
  context and output limits the app sizes its window from.
- Only the prompt count limits usage. Token budgets, rpm and tpm are
  effectively unlimited — the server stops nothing, so the app enforces
  the prompt quota before sending.
- Plan-gated: Starter users must not see `frontier` in the picker.
