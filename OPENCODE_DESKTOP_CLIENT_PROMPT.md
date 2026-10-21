# MASTER PROMPT — Make OpenCode Desktop the official client for the Zaino Gateway

> Paste this entire document to the implementing agent as its starting context.
> It is self-sufficient: it describes both repositories, the gateway contract,
> the OpenCode Desktop shape, the required integration, and the proof that must
> pass before the change is considered done.
>
> Companion context: `CONTEXT.md` (gateway), `docs/device-code-flow.md`,
> `HANDOFF.md` (engineering log), `README.md`. Do not contradict them; if this
> prompt and a companion doc disagree, the companion doc wins and this prompt
> must be corrected.

---

## 0. Mission

**Make OpenCode Desktop (`/Users/user/Workspace/opencode/desktop`, Electron 44,
`@opencode/desktop` v2.1.1) the *only* first-party desktop client for the
Zaino Gateway**, replacing the in-house "Zaino AI Agent" Tauri app. Concretely:

1. A fresh OpenCode Desktop install, pointed at Zaino, can sign in with a
   browser-based device code (no key pasting) and land on a working chat.
2. The three gateway aliases `fast` / `smart` / `frontier` are the only model
   names the user ever sees; upstream names never leak.
3. Inference traffic uses the user's `zn-…` credential through the auth edge;
   the key lives in the OS keychain and is never written to config, logs, or
   the renderer.
4. The portal's download page, docs, and onboarding point at OpenCode Desktop
   (binaries + config), not at the legacy Tauri app.
5. `make smoke` / `make verify-metering` remain green; the new client path has
   its own acceptance suite.

**Non-goals:** changing gateway billing, pricing, or the device-code protocol.
The protocol is already specified in `docs/device-code-flow.md` and is reused
as-is. This is a *client* integration task, not a gateway redesign.

---

## 1. Repositories and paths

| Repo | Path | Role |
|---|---|---|
| Gateway (this repo) | `/Users/user/Workspace/gateway` | Control plane (portal) + data plane (Caddy/auth-edge/LiteLLM) |
| OpenCode Desktop | `/Users/user/Workspace/opencode/desktop` | Electron shell around `@opencode/app` |
| OpenCode app (shared) | *not checked out here* — lives in the OpenCode monorepo as `packages/app` | Renderer, provider picker, onboarding. Referenced via `@opencode/app: workspace:*` |

The OpenCode Desktop tree depends on `@opencode/app`, `@opencode/client`,
`@opencode/ui`, `@opencode/schema`, `@opencode/gui-extensions` from the
monorepo. **If those packages are not present, stop and ask — do not vendor
them.** The monorepo root is the parent of `desktop/` in a full checkout; here
only `desktop/` exists, so provider/auth UI work must be coordinated with the
OpenCode maintainers or done via a config-only shim first.

Working agreement: edit in place in each repo, commit separately, never cross
commit boundaries. Gateway commits go to `origin`/`gateway` remotes per
`plans/complete-the-dev.md` §0.

---

## 2. Zaino Gateway — system of record

### 2.1 Request path

```
client (OpenCode Desktop)
  → Caddy (TLS, public :80/:443)
  → auth-edge (node, 127.0.0.1:4001)   zn- → sk- rewrite + /v1/responses shim
  → LiteLLM (127.0.0.1:4000)            auth, budgets, rate limits, routing
  → upstream https://api.howtofix.id/v1
```

- Base URL for clients: `https://api.zaino.soon.it` (prod) / the sslip.io host
  in staging. Anthropic-style clients use the host root; OpenAI-style clients
  use `/v1`.
- Credential: `zn-<43-char base64url body>`. The edge rewrites the leading
  `zn-` to `sk-`. Sending `zn-` straight to LiteLLM (port 4000) returns 401 —
  the edge is mandatory.
- Management routes (`/key`, `/user`, `/team`, …) are denied at the edge
  (404) as defence in depth.

### 2.2 Models (aliases only)

| Alias | Deployments | Context / Output | Tool calling | Reasoning |
|---|---|---|---|---|
| `fast` | nemotron-3.5-lightning, space-bunny, cat-jam, deepseek-v4.1-flash | 262144 / 32768 | yes | yes |
| `smart` | longcat-2.5-preview, mimo-v2.6, mimo-v2.6-flash, big-pickle | 262144 / 32768 | yes | yes |
| `frontier` | grok-4.6-liberated, muse-spark-1.3-contributor, muse-spark-1.2-contributor | 262144 / 32768 | yes | mixed (see prices/models.yaml) |

**Invariant:** customers see only `fast` / `smart` / `frontier`. No upstream
name may be stored, rendered, exported, or logged on the client. The portal's
`prices/models.yaml` + `config/litellm.yaml` are the two rate tables; they
must agree (enforced by `portal/tests/pricing-consistency.test.ts`).

### 2.3 Supported endpoints

- `/v1/chat/completions` (OpenAI)
- `/v1/messages` (Anthropic)
- `/v1/responses` (OpenAI Responses) — translated by the edge shim to chat
  completions so metering stays on the one priced shape.
- `/v1/models` — returns the alias list.

`/v1/responses` is deliberately absent from every `supported_endpoints` in
LiteLLM; the edge owns it.

### 2.4 Device-code sign-in (reuse verbatim)

Full spec: `docs/device-code-flow.md`. Summary:

- `POST /api/auth/device` (anonymous) → `{ device_code, user_code,
  verification_url, expires_in: 900, interval: 5 }`. Only SHA-256 of
  `device_code` is stored.
- Browser: person signs in (Auth.js), approves `user_code` via
  `POST /api/auth/device/verify` (same-origin, active plan, developer+ role).
  Approval **rotates** the org's device key: all previous `kind='device'`
  keys revoked upstream+locally, one fresh key minted (plan models, 30-day
  `duration`), plaintext held in `device_codes.key_plaintext` (nulled on
  consume).
- App polls `POST /api/auth/device/token` with `{ device_code }` every
  `interval` seconds. Responses: granted (200, one-time) / pending (400
  `authorization_pending`) / slow_down / expired_token / invalid_grant /
  access_denied.
- Portal host: `https://portal.zaino.soon.it` (or sslip.io staging).
  Verification URL returned by the API is absolute and must be opened in the
  system browser, not the app webview.

Invariants: no secret in config/settings/renderer/logs/audit. One device key
per org. ~30-day lifetime; restart within 30 days needs no sign-in. Plan
changes flow through `planForOrg()`.

### 2.5 Billing / limits (client-relevant)

- Plans: Starter `$19/mo` → `{fast, smart}`, 3 keys, 60 rpm, 200k tpm,
  ×1.30. Pro `$99/mo` → `{fast, smart, frontier}`, 15 keys, 300 rpm,
  1.5M tpm, ×1.25.
- Device key inherits the plan's models, rpm, tpm, budget, concurrency.
- `frontier` may be hidden from the picker until Pro metering ships (see FAQ
  in the portal download page). Decide per plan: Starter users must not see
  `frontier`.

### 2.6 Key prefix rule (load-bearing)

Customer credential `zn-<body>`; gateway stores `sk-<body>` (same body).
LiteLLM's key normalizer only hashes `sk-`-prefixed values, so the edge
rewrite is structural and cannot be bypassed. The client must send the
credential **exactly as issued** (`zn-…`) in `Authorization: Bearer …` (or
`X-Api-Key`); it must never strip or rewrite the prefix, and must never
display/log the body.

---

## 3. OpenCode Desktop — current shape

- Electron 44.9.1, electron-vite, SolidJS renderer (`@opencode/app`).
- Main process: `src/main/index.ts`, IPC layer `src/main/ipc*.ts`, storage
  `src/main/storage`, service sidecar `src/main/service`.
- Onboarding flow: `src/renderer/onboarding/index.tsx` syncs
  `data.location.provider` and `data.location.model`.
- Configuration is the standard OpenCode JSON (`opencode.json(c)`) with a
  `provider` map; providers use `@ai-sdk/openai-compatible` with
  `baseURL`/`apiKey`/`models`.
- No existing Zaino provider, no device-code flow, no keychain integration
  for arbitrary providers.

The desktop is a thin shell: provider/auth/onboarding logic lives in
`@opencode/app` (monorepo, not checked out here). Therefore the integration
has two tiers:

- **Tier 1 (config-only, doable in this repo):** ship a default
  `opencode.json` snippet + env var contract + docs so a user can point
  OpenCode at Zaino manually (`ZAINO_API_KEY=zn-… opencode`).
- **Tier 2 (first-class, requires monorepo):** device-code sign-in UI,
  keychain storage, provider registration, onboarding, model picker filtering
  by plan, usage display. This is the "official client" bar.

---

## 4. Target experience

1. User downloads OpenCode Desktop from the portal download page.
2. First launch: onboarding asks "Sign in with Zaino" (primary) and
   "Paste device key" (fallback), exactly mirroring the existing device flow
   UX in `docs/device-code-flow.md`.
3. Browser opens `https://portal…/device?user_code=XXXX`; person signs in and
   approves.
4. App collects the `zn-…` key once, writes it to the OS keychain, refreshes
   the model catalog (`fast`/`smart`[/`frontier`]), wires the provider with no
   secret in config.
5. Chat works on `fast` by default; model picker shows only plan-allowed aliases.
6. Restart within 30 days: keychain restore + background catalog refresh, no
   sign-in. Expired/revoked key clears and prompts sign-in.
7. Inference traffic goes through the gateway; usage appears in the portal
   dashboard.

---

## 5. Integration contract (exact)

### 5.1 Provider config (OpenCode JSON)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "zaino": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Zaino Gateway",
      "options": {
        "baseURL": "https://api.zaino.soon.it/v1",
        "apiKey": "{env:ZAINO_API_KEY}",
        "timeout": 300000,
        "headerTimeout": 300000,
        "chunkTimeout": 300000
      },
      "models": {
        "fast": {
          "name": "Zaino Fast",
          "family": "zaino",
          "limit": { "context": 262144, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] },
          "tool_call": true,
          "reasoning": true
        },
        "smart": {
          "name": "Zaino Smart",
          "family": "zaino",
          "limit": { "context": 262144, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] },
          "tool_call": true,
          "reasoning": true
        },
        "frontier": {
          "name": "Zaino Frontier",
          "family": "zaino",
          "limit": { "context": 262144, "output": 32768 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "tool_call": true,
          "reasoning": true
        }
      }
    }
  },
  "model": "zaino/fast"
}
```

Rules:
- `baseURL` ends in `/v1` (OpenAI-compatible). For Anthropic-native mode use
  the host root with the Anthropic SDK — but OpenCode uses openai-compatible,
  so `/v1` is correct.
- `apiKey` must be `{env:ZAINO_API_KEY}` in any committed/shared config; the
  device flow sets the env var in the process environment or writes to the
  OS keychain and exposes it to the sidecar. **Never** write `zn-…` into
  `opencode.json`.
- Model keys are exactly `fast`/`smart`/`frontier` (aliases). `frontier` is
  conditionally enabled by plan; the picker filters client-side using the
  catalog returned by `POST /api/auth/device/token` (`models` array).

### 5.2 Device flow (client side)

Reuse the state machine documented in `docs/device-code-flow.md`:

- Rust reference (ccgui): `gateway_device_begin`, `gateway_device_cancel`,
  events on `gateway://device`. OpenCode is TS/Electron, so implement in main
  process (`src/main`) with IPC to renderer.
- Main process holds the `zn-…` token in memory + OS keychain (Electron
  `safeStorage` or `keytar`); renderer sees only `{ user_code,
  verification_url }` and phase events.
- Polling: every `interval` seconds (clamp to ≥ the server's interval;
  back off on `slow_down`).
- On grant: validate key shape (`zn-` + ≥16 body chars), write keychain,
  store user/org/models in secure state, trigger catalog refresh, configure
  provider with `ZAINO_API_KEY` in env, navigate to chat.
- On 401 from gateway on any request: clear keychain entry, prompt sign-in.

### 5.3 Endpoints the client calls

| Method | URL | Auth | Purpose |
|---|---|---|---|
| POST | `{portal}/api/auth/device` | none | issue code |
| GET | `{portal}/device?user_code=…` | browser session | approval page (opened in system browser) |
| POST | `{portal}/api/auth/device/verify` | Auth.js session + same-origin | approve code |
| POST | `{portal}/api/auth/device/token` | device_code | poll / collect key |
| GET | `{gateway}/v1/models` | `zn-…` | catalog (aliases) |
| POST | `{gateway}/v1/chat/completions` | `zn-…` | inference |

Portal host and gateway host are distinct (`portal.*` vs `api.*`). Do not
conflate them; the device code's `verification_url` is already absolute.

### 5.4 Usage reporting (optional, Tier 2)

The portal's device usage endpoint `GET {portal}/api/device/usage` exists for
the legacy client. OpenCode may call it for a "usage" panel, but must not
block chat on it. Prefer the gateway's own `/v1/models` + chat responses for
runtime; usage accounting stays server-side.

---

## 6. Work plan

### Phase 0 — Tier 1 (config-only, this week, no monorepo needed)

1. Add a `docs/opencode-desktop.md` to the gateway repo with the §5.1 config
   snippet and env var instructions.
2. Update portal download page (`portal/components/marketing/download-content.tsx`
   and `portal/app/(marketing)/download/page.tsx`) to lead with OpenCode
   Desktop: download buttons point at OpenCode releases, install steps mention
   `ZAINO_API_KEY`, remove "Zaino AI Agent" branding from the hero.
3. Update `README.md` "Clients" section: add OpenCode Desktop block alongside
   Claude Code / OpenAI SDK / Anthropic SDK.
4. Update `MASTER_PROMPT.md` if it references the legacy client.

### Phase 1 — OpenCode Desktop core (requires monorepo)

5. Add a `zaino` provider template to OpenCode's default provider list or a
   setup wizard (`opencode provider add zaino`) that writes the §5.1 config
   with `{env:ZAINO_API_KEY}` and prompts for the key.
6. Implement device-code flow in `src/main` (main process) + IPC + renderer
   onboarding, mirroring `docs/device-code-flow.md`. Store token in
   `safeStorage`/keychain.
7. Wire `ZAINO_API_KEY` into the sidecar environment without persisting it.
8. Model picker filters `frontier` based on the granted `models` array.

### Phase 2 — Portal & docs

9. Rename `DEVICE_KEY_NAME` from `'Zaino Desktop'` to `'OpenCode Desktop'`
   in `portal/lib/auth/device/service.ts` (audit rows + key alias). Migration
   not required (string data).
10. Update portal FAQ/download copy: "OpenCode Desktop" everywhere; keep the
    legacy app download as "Legacy (deprecated)" for one release.
11. Add `GET /api/device/usage` documentation to `docs/device-code-flow.md`
    noting OpenCode as a consumer.

### Phase 3 — Proof

12. Add an acceptance script `scripts/verify-opencode-client.sh` (or extend
    `smoke.sh`) that: mints a device key via the flow (or uses a test key),
    calls `/v1/models` expecting exactly `fast`,`smart` (or +`frontier`),
    sends one chat completion on `fast`, asserts no upstream name in the
    response, asserts 401 on a revoked key.
13. Update `make smoke` to include the new checks behind a flag
    (`SMOKE_CLIENT=opencode`).

---

## 7. File-level change list

### Gateway repo (`/Users/user/Workspace/gateway`)

- `docs/opencode-desktop.md` — new: client setup guide (Phase 0).
- `docs/device-code-flow.md` — add OpenCode as a named consumer; no protocol
  change.
- `README.md` — "Clients" section: add OpenCode Desktop block.
- `portal/lib/auth/device/service.ts` — `DEVICE_KEY_NAME` rename.
- `portal/components/marketing/download-content.tsx` — rebrand to OpenCode
  Desktop; update STEPS copy (keychain, model names).
- `portal/app/(marketing)/download/page.tsx` — metadata title/description.
- `scripts/smoke.sh` — optional OpenCode client checks.
- `scripts/verify-opencode-client.sh` — new acceptance script.
- `MASTER_PROMPT.md` — mention OpenCode Desktop as official client.

### OpenCode Desktop repo (`/Users/user/Workspace/opencode/desktop`)

- `src/main/zaino/` (new) — device flow main-process module:
  - `device.ts`: `begin()`, `cancel()`, poll loop, keychain read/write via
    `safeStorage`.
  - `provider.ts`: writes/updates `opencode.json` provider entry without
    secret; sets `ZAINO_API_KEY` in sidecar env.
  - `ipc.ts`: IPC channels `zaino:device:begin`, `zaino:device:cancel`,
    events `zaino:device:phase`.
- `src/renderer/onboarding/` — add Zaino sign-in step (requires `@opencode/app`
  changes; if unavailable, gate behind a feature flag and ship config-only).
- `src/preload/` — expose the IPC surface.
- `resources/` — maybe add a default config template.

### OpenCode monorepo (not present here — coordinate)

- `packages/app/src/...` provider picker + onboarding must learn "Zaino" as a
  provider with device auth. This is the bulk of Tier 2 and is out of scope for
  a single-repo PR; track as a separate issue.

---

## 8. Invariants (do not violate)

1. **No upstream model name on the client.** Only `fast`/`smart`/`frontier`.
   The granted `models` array from the device token is the source of truth for
   which aliases a device may use.
2. **No secret in config/logs/renderer/audit.** The `zn-…` body exists in
   exactly three places: `device_codes.key_plaintext` (≤15 min, nulled on
   consume), proxy memory (runtime), OS keychain (at rest).
3. **One device key per org.** Approval rotates; never stack keys.
4. **Send the credential verbatim.** `Authorization: Bearer zn-…`. Do not
   rewrite to `sk-` on the client — the edge does that.
5. **Fail closed.** A revoked/expired key clears local state and prompts
   sign-in; never silently fall back to anonymous.
6. **Tier membership is by measured latency, not quality.** Do not reorder or
   rename tiers in client copy beyond the alias names.
7. **`frontier` gating.** Starter plans must not expose `frontier` in the
   picker even if the config lists it; filter by granted `models`.

---

## 9. Traps (already paid for once)

- OpenCode config uses `provider` (singular) not `providers`; field names are
  in the V2 schema. Do not guess — fetch `https://opencode.ai/config.json`
  shape via the V2 docs.
- `{env:ZAINO_API_KEY}` substitution happens at server load; if the env var is
  unset, the provider is unusable but not errored. Validate at startup.
- Electron `safeStorage` is unavailable until the app is ready; initialize
  keychain access after `app.whenReady()`.
- The portal and gateway are different hosts. Device `verification_url` is
  absolute; do not rebuild it from a base URL.
- CORS: the portal's device endpoints are same-origin browser flows; the app
  calls them from the main process (no CORS) — keep device calls in main, not
  renderer.
- Do not log the key body, its length, or a slice — only a boolean
  `prefix_substituted`-style flag if needed.
- OpenCode's sidecar uses Basic auth with a generated password; `ZAINO_API_KEY`
  must be injected into the sidecar env, not into its config file.

---

## 10. Acceptance criteria (all must hold)

1. `cd portal && npm run typecheck && npm test && npm run build` green after
   the `DEVICE_KEY_NAME` rename and copy changes.
2. `make verify-config` and `./scripts/scrub-check.sh` green.
3. A device key minted for a Starter org grants `models: ["fast","smart"]`;
   for Pro, `["fast","smart","frontier"]`.
4. `/v1/models` called with the minted key returns exactly those aliases and
   no upstream names.
5. One chat completion on `fast` succeeds end-to-end through the edge shim
   (streaming) and appears in the portal usage dashboard within one collection
   cycle.
6. A revoked key returns 401 on the next request and the client clears its
   keychain entry.
7. Restarting OpenCode Desktop within 30 days does not require sign-in.
8. Portal download page title/metadata say "OpenCode Desktop" and the primary
   download points at OpenCode releases.
9. No `zn-` plaintext appears in any committed file, log, or audit row.

---

## 11. Verification commands

```bash
# Gateway
cd /Users/user/Workspace/gateway
make verify-config
cd portal && npm run typecheck && npx vitest run && npm run build
./scripts/smoke.sh zn-<test-key>

# OpenCode Desktop
cd /Users/user/Workspace/opencode/desktop
bun run typecheck
bun test --timeout 30000
bun run build
```

For the device flow, reuse the existing portal proof:
`make verify-d17` (covers approval + polling + rotation) and
`make verify-metering` (covers key lifecycle). Do not invent a new proof
framework — extend `scripts/smoke.sh` with a client section.

---

## 12. Out of scope

- Changing gateway pricing, billing, or the device-code protocol.
- Implementing `@opencode/app` UI changes (monorepo not present) — tracked
  separately; Tier 1 ships without them.
- Notarization/signing of OpenCode Desktop binaries (OpenCode's own release
  pipeline).
- Removing the legacy "Zaino AI Agent" download entirely — keep for one
  release as deprecated fallback.

---

## 13. Definition of done

OpenCode Desktop is the official client when: (a) the portal download page
and docs point at it, (b) a fresh install can sign in via device code and
chat on `fast`, (c) keys live in the OS keychain and never in config, (d) all
gateway proofs remain green, and (e) the acceptance checks in §10 pass.
