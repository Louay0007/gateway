# Claude Desktop against the gateway

Claude Desktop connects to `api.zaino.soon.it` as a **custom inference
gateway** (3P mode). This is the same gateway the SDKs use — same keys, same
quotas, same `/v1/messages` path — but the desktop app keeps its own profile
file, and two fields there decide whether it honours the 1M context window.

## Why the 1M toggle appeared to do nothing

The app stores each provider's model list in a named profile:

```
~/Library/Application Support/Claude-3p/configLibrary/<uuid>.json
~/Library/Application Support/Claude-3p/configLibrary/_meta.json   ← appliedId
```

An `inferenceModels` entry looks like this, and every field matters:

```json
{
  "name": "claude-smart",
  "labelOverride": "claude-smart",
  "supports1m": true,
  "prefer1m": true,
  "anthropicFamilyTier": "sonnet"
}
```

| field | what it does | what breaks without it |
|---|---|---|
| `supports1m` | declares the gateway serves a 1M window | the client caps the window at its default |
| `prefer1m` | asks for 1M **by default** | you must re-enable it every session; `false` keeps ~200K |
| `anthropicFamilyTier` | the family the client derives native context size and effort from | a custom name gets **no** native entry, so the toggle is ignored |

The symptom that started this: the context bar read `120.5K / 160K (75%)` and
"auto-compacts soon" on a model that serves 1,048,576 tokens. The gateway was
already advertising `context_window: 1048576` (see `edge/server.mjs`
`advertiseModelSizes`); the profile simply never asked for it.

## Apply

```bash
python3 scripts/claude-desktop-configure.py --dry-run   # show the plan
python3 scripts/claude-desktop-configure.py             # write + apply
python3 scripts/claude-desktop-configure.py --revert     # back to Default
```

Then **quit and reopen Claude Desktop** — the profile is read at launch.

The script writes eight models (the four tiers under both spellings), keeps
`managedMcpServers` from the working `Default` profile, and copies the sealed
API key through untouched. It never reads or prints the key.

## Verify

```bash
# the gateway side must answer for every name the picker offers
for m in claude-frontier claude-smart claude-fast claude-fable \
         frontier smart fast fable; do
  curl -sS -o /dev/null -w "$m %{http_code}\n" https://api.zaino.soon.it/v1/messages \
    -H "Authorization: Bearer zn-$KEY" -H 'Content-Type: application/json' \
    -H 'anthropic-version: 2023-06-01' \
    -d "{\"model\":\"$m\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}"
done
```

All eight answer `200`. In the app, the context bar should then read against
1M rather than 160K.

## What the app inherits from the gateway

Because it is the same gateway, Claude Desktop gets the same behaviour the
SDKs do — verified on the live box:

- **1M context**, 64k max output, on every tier.
- **Tool calling**, including parallel calls and multi-turn `tool_result`
  loops (a two-read turn followed by a chained `run_tests` was measured).
- **Vision** on `/v1/messages`.
- **Prompt caching** — `cache_control` is honoured; a repeated 25K block
  returned 24,906 cached tokens.
- **`/v1/messages/count_tokens`**, which the app calls every turn for its
  context meter. `claude-*` names resolve there as well as on the chat path.

Two things the gateway does **not** provide, because the upstream does not:
extended thinking (`supports_reasoning: false` — every reasoning knob was
measured returning 0 reasoning tokens) and sub-second first-token latency
(1.1–2.9s measured direct to the provider).
