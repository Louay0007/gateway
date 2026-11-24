# Claude Desktop aliases (`claude-fast` / `claude-smart` / `claude-frontier` / `claude-fable`) — investigation

Read-only investigation. No code changed.

## Summary answer

**The transport already works. The names do not.**

1. `/v1/messages` is served today by **LiteLLM passthrough**, not by a translation shim. `edge/server.mjs` forwards the body verbatim to LiteLLM after one narrow body filter (PDF / URL-image blocks). `anthropic-version` is **never validated** anywhere in the chain; `x-api-key` **and** `Authorization: Bearer` are both accepted and both go through the `zn-`→`sk-` rewrite.
2. `model=claude-fast` is **rejected today by LiteLLM with a 400** ("Invalid model name passed in"). The edge does **not** map it: `modelRejection()` only runs on `/v1/chat/completions` and `/v1/responses` (`edge/server.mjs:460-478`, `edge/server.mjs:693-697`), never on `/v1/messages`. There is no `models.yaml` wildcard fallback — `prices/models.yaml` `aliases:` is exact-match, keyed on the *upstream* name.
3. **The cheapest mechanism that already exists is LiteLLM `model_list` with a shared deployment, and this repo already depends on it working** — the vendor's own client config assigns `frontier` + `fable` to `@opencode/ai/providers/anthropic-compatible` and to `/v1/messages` (`docs/opencode-desktop.md:64-70`). There is **no** `model_group_alias` in `router_settings` (`config/litellm.yaml:184-213`) and **no** regex/prefix rewrite in the edge. Two candidate mechanisms exist; the evidence (below) points to a **second `model_list` entry per model** as the one that works, with `model_group_alias` as the cheap-and-correct device to test first.
4. `claude-*` aliases must **never** enter `plans.models` / `api_keys.models` / `usage_records.model`. Doing so would require a DB migration, four portal allowlists, and would double-count the pool. The correct design maps `claude-fast` → `fast` **inside the gateway**, so the alias the ledger sees is still `fast`.
5. **1M context is already reachable and already advertised.** `max_input_tokens: 1048576` is set on all four deployments (`config/litellm.yaml:86,113,140,166`), LiteLLM publishes it on `GET /v1/models` (documented as verified live in `docs/usage-tracking-gaps.md:60-77`), and the plan copy says 1M (`portal/lib/pricing/facts.ts:139-140`). **The one thing that caps it below 1M is the client, not the gateway** — an Anthropic-format client is told nothing about the window by `/v1/messages`, and Claude Desktop has no per-model limit field in its custom-model dialog.

## Evidence

### 1. Which component serves `/v1/messages`, and what it does to the request

Chain: `client → Caddy (config/Caddyfile:50) → auth-edge :4001 (edge/server.mjs) → LiteLLM :4000 (docker-compose.yml:53-103) → upstream`.

| Question | Answer | Evidence |
|---|---|---|
| Who serves `/v1/messages` | LiteLLM, transparently. The edge only buffers, sanitizes, re-sets `content-length`, forwards. | `edge/server.mjs:427-441` |
| Is `anthropic-version` required/validated | **No.** The edge has zero special-casing; the header passes through untouched in the generic copy loop. LiteLLM defaults/anthropic adapter handles it. The portal's own caller sends `2023-06-01` explicitly, from *its own* client, not the edge. | `edge/server.mjs:380-392` (header copy), `portal/lib/chat/gateway.ts:265`, `portal/lib/litellm/client.ts:763` (only for `api.anthropic.com` usage reports) |
| `x-api-key` accepted | **Yes**, and it is rewritten `zn-`→`sk-` exactly like `Authorization`. | `edge/server.mjs:394-401`, test `portal/tests/auth-edge.test.mjs:275-279` |
| Is `model` stripped/rewritten before LiteLLM | **On `/v1/messages`: no.** Only `sanitizeRequest()` runs, which rewrites `document`(base64) and `image`(url) blocks to text notes and touches nothing else. `resolveModelAlias()` is called only on `/v1/chat/completions`. | `edge/server.mjs:427-441`, `edge/upstream-guard.mjs:78-103`, `edge/server.mjs:443-455` |
| Body ceiling on that path | 32 MB, then 413. Matters for 1M-token prompts only marginally (1M tokens ≈ 4 MB of text), but a PDF-heavy history can approach it. | `edge/server.mjs:596-613` |
| Caddy ceiling | 10 MB on the public API vhost. **This is the real 1M-context cap**: 1M tokens of non-ASCII / JSON-escaped text can exceed 10 MB. Dense CJK or Arabic at ~1 token/byte plus JSON escaping sits close; English at ~4 bytes/token does not. | `config/Caddyfile:57-59` |

Identifier check: `MODEL_ALIAS` is declared once (`edge/server.mjs:130`) and used consistently at lines 170, 183, 185, 186, 267, 458-459, 674-675. No mismatch, nothing to fix.

### 2. Unknown-alias behaviour: what happens to `model=claude-fast` today

1. Caddy: no path or body rule matches → proxied to auth-edge.
2. auth-edge: `POST /v1/messages` → `readBody` → `sanitizeRequest` → nothing to fix (no PDF, no URL image) → forwarded byte-identical. `modelRejection()` is **not called on this path** (`edge/server.mjs:433-441` has no such call; the only two call sites are line 470 and line 694).
3. LiteLLM: no `model_name: claude-fast` in `model_list`, no `model_group_alias`, `store_model_in_db: true` so a DB-registered model could match but none is registered (`config/litellm.yaml:257-258`) → returns **400 `Invalid model name passed in model=claude-fast`**.
4. The edge returns that 400 verbatim (only 403 bodies are inspected for model-denial wording — `edge/server.mjs:497-503`).

So today: **400 from LiteLLM, not a 403, not a mapping.** Same for `claude-fast` on `/v1/chat/completions` — the edge rejects it first with a 400 `Unknown model 'claude-fast'. Use fast, smart, frontier, fable ...` (`edge/server.mjs:166-173`).

### 3. Mechanisms already present vs needed

| Mechanism | Present? | Evidence |
|---|---|---|
| `router_settings.model_group_alias` | **No** | `config/litellm.yaml:184-213` — no such key |
| Regex / prefix rewrite in the edge | **No** | `edge/server.mjs:117-131` is a fixed four-entry literal map; `resolveModelAlias` (line 150) does an exact lookup only |
| Per-model `model_name` entry in `model_list` | **Yes, and this is the load-bearing one** | `config/litellm.yaml:66-172`. `docs/opencode-desktop.md:64-68` states that `frontier` and `fable` are served over `@opencode/ai/providers/anthropic-compatible` / `/v1/messages` — i.e. a LiteLLM-registered name reached over the Anthropic path is an assumption the vendor's own client already ships |
| `store_model_in_db: true` (DB-registered models) | Yes | `config/litellm.yaml:258` — an alternative to config entries, but the repo has no writer for it (`grep /model/new` in `portal/` and `scripts/` → no match), so a config edit is the honest mechanism |
| LiteLLM `custom_llm_provider: anthropic` / native Anthropic pass-through | **No** — every deployment is `openai/<model>` | `config/litellm.yaml:68,88,110,145` |

**Recommendation:** add four `model_list` entries named `claude-fast|claude-smart|claude-frontier|claude-fable`, each with `litellm_params.model: openai/<same upstream>` and **identical** `model_info` (rates, `max_input_tokens`, `max_output_tokens`, `supported_endpoints`). Reasoning, in order:

- `model_list` is proven to be the naming surface the router consults on `/v1/messages` (evidence in `docs/opencode-desktop.md` above); `model_group_alias` is unverified in this repo and would silently degrade to a 400 if wrong.
- Budgets and the token wall do not attach to the model name — enforcement is the `models:` allowlist pushed onto the team and each key (`portal/lib/litellm/client.ts:291-313`, `docs/opencode-desktop.md:86-89`). Keep the **allowlist** on `fast|smart|frontier|fable` and the `claude-*` deployments stay reachable (an allowlist entry restricts a key to a name; a deployment not in the key's list is not automatically refused — verify with the smoke below before shipping).
- **`model_info` duplication is not free**: `portal/tests/pricing-consistency.test.ts:296-327` parses `config/litellm.yaml` and **fails** if any deployment (`d.bare`, the segment after `/`) has no entry in `prices/models.yaml` `aliases:`. Four new deployments sharing the same `openai/haiku-5.5` etc. produce the same `d.bare` values, so no new `aliases:` entry is needed — but the test's `stale` check (line 318-324) will also pass for the same reason. **Net: no `prices/models.yaml` change required.** Confirm by running the test.
- `model_group_alias` would avoid the duplication; if a trial shows it resolves on `/v1/messages` under the pinned `v1.103.1` image, prefer it and drop four blocks to six lines. Try it first — it is a 5-line diff either way and the trial is one curl.

### 4. Every place an alias name is enumerated

Listed in the order they would break, with what breaks.

| # | File | What it enumerates | Breaks how if `claude-*` is added there | Breaks how if `claude-*` is *not* added there |
|---|---|---|---|---|
| 1 | `portal/db/migrations/0011_usage_aliases.sql:98-103,122-126` | `CHECK (model IN ('fast','smart','frontier','unknown'))` + a guard that RAISEs on any other value | A ledger row with `claude-fast` **fails the constraint** at insert time; the collector's whole batch aborts (`portal/lib/jobs/collect-usage.ts:110-129`) | Nothing — **as long as the collector resolves `claude-*` back to its tier alias** |
| 2 | `prices/models.yaml:70-75` (`aliases:`) | upstream model → tier alias; regex in the test is `(fast\|smart\|frontier\|fable)` | An entry `haiku-5.5: claude-fast` would break the registry (one key cannot hold two values) and change every historical dashboard | Nothing |
| 3 | `portal/lib/pricing/alias.ts:37` `TIER_ALIASES` | the four tier aliases | Adding `claude-*` makes `toAlias('claude-fast')` return `claude-fast` instead of `fast` → dashboard shows a fifth tier | Nothing; `toAlias` falls to the `aliases:` map, which is keyed on upstream names, so `claude-fast` resolves to `unknown` **unless** the edge/gateway reports `model_group` as `fast` |
| 4 | `portal/lib/pricing/facts.ts:65-70` `RATES`, `:109-116` `PLAN_FACTS.models` | four rows / plan lineups | `portal/tests/pricing-facts.test.ts:47,98` asserts exact arrays → fails | Nothing |
| 5 | `portal/components/docs/docs-data.ts:24-25,86+` `TIERS`, `CONTEXT_WINDOW` | four tiers + 1M window | `portal/tests/docs-truth.test.ts:39-44` asserts exact order → fails | Nothing |
| 6 | `portal/components/chat/aliases.ts:58` `ALIAS_ORDER` | four aliases, used to rank the model picker (`portal/lib/chat/screen.ts:152-156`) | A `claude-*` alias with no meta renders unbranded; the picker would offer two names for one tier | Nothing |
| 7 | `portal/components/dashboard/quota-meter.tsx:118-124,226` | local `ALIAS_ORDER` + display-name ternary | A `claude-*` key with tokens would show up as a second meter row | Nothing (falls back to the raw string) |
| 8 | `portal/app/api/playground/route.ts:58` / `scheduled/route.ts:35` / `scheduled/[id]/route.ts:27` | `z.enum(['fast','smart','frontier','fable'])` | Playground / scheduled-chat would accept `claude-*` — a second entry point for a name that only Claude Desktop should use | Correct as-is: **keep them out**, these are product surfaces |
| 9 | `portal/lib/keys/policy.ts:215-248` `assertModelsAllowed` | exact-match subset of `planModels` | A customer could mint a key scoped to `claude-fast`, which is not a plan model → rejected today with "not included in your plan" | Correct as-is |
| 10 | `portal/lib/auth/provision.ts:54` `DEFAULT_MODELS` | default team allowlist | would widen the wall | Nothing |
| 11 | `scripts/reconcile.sh:111-116` `ALIAS = {...}` | alias → upstream model; parsed and cross-checked by `portal/tests/pricing-consistency.test.ts:328-352` | A `claude-*` entry pointing at an existing model passes; the mirror direction ("every served alias has a mapping") would demand an entry per new `model_name` | **Fails** — `pricing-consistency.test.ts:344-351` requires every `deployments[].alias` to appear in `reconcile.sh`'s `ALIAS` map |
| 12 | `scripts/mock-upstream.mjs:247-257` | `/v1/models` stub listing four aliases | local smoke-local shows a stale catalog | cosmetic |
| 13 | `docs/opencode-desktop.md:81-89` | prose stating four aliases, 1M/64K, allowlist mechanism | docs drift | cosmetic; the doc is the spec for the desktop catalog |
| 14 | `portal/lib/entitlements/quota.ts:339-365` | regex `(fast\|smart\|frontier\|fable)` used to attribute a 403 message | a `claude-*` denial message would attribute to no alias | cosmetic |
| 15 | `portal/tests/connect-snippets.test.ts:24` `ALIASES` | four names, used to iterate snippets | a new name would be asserted through every tool snippet | cosmetic (test only) |

**The load-bearing conclusion from this table:** the only place that *fails hard* is #1 (the DB CHECK) and #11 (`reconcile.sh`) — both only if `claude-*` leaks into the ledger or becomes a `model_name` in `litellm.yaml`. Row #1 is avoided by design if the ledger keeps writing `fast`; row #11 must be updated in the same commit as any new `model_name`.

### 5. 1M context: how it is surfaced, and what caps it

| Layer | What it does | Evidence |
|---|---|---|
| Deployment metadata | `max_input_tokens: 1048576`, `max_output_tokens: 65536` on all four | `config/litellm.yaml:86-87,113-114,140-141,166-167` |
| `GET /v1/models` | LiteLLM publishes both fields itself; no `model_info`/`public_model_info` block needed. **Verified live** and recorded as a disproven gap. | `docs/usage-tracking-gaps.md:60-77` |
| `/v1/messages` response | **Does not carry any limit.** The Anthropic Messages API has no field for it — the body is `id/type/role/content/model/stop_reason/usage`. Nothing to add; a client that wants the window must read `/v1/models`. | wire format; `portal/lib/chat/gateway.ts:135-165` builds the inbound body and reads none |
| Plan copy | "Context window: 1M", "Max output: 64k" on both plans | `portal/lib/pricing/facts.ts:139-140`, `portal/components/docs/docs-data.ts:24-25` |
| Codex config | `model_context_window = 1048576` written into the snippet | `portal/components/docs/docs-data.ts:207-223` |
| Existing "+1M" claim to test | `docs/opencode-desktop.md:80-82` claims the catalog advertises 1M/64K and the app sizes its window from it. **`mobile-app/` contains no reader of those fields** (`grep max_input_tokens mobile-app` → no match), so this claim is unproven for the in-repo clients. | `docs/opencode-desktop.md:80` |

**What caps it below 1M today:**

1. **Caddy's 10 MB `request_body` on the public API vhost** (`config/Caddyfile:57-59`). 1M tokens of JSON-escaped Arabic / CJK / code with escapes will approach or exceed it. This is the only *gateway-side* cap that could bite. Raising it for `/v1/messages` is a matcher-scoped `request_body` block, following the pattern already documented for the portal vhost (`config/Caddyfile:150-190`).
2. **The edge's 32 MB body ceiling** (`edge/server.mjs:596`) — above the Caddy cap, so Caddy wins; no change needed unless Caddy is raised past 32 MB.
3. **Timeouts** — not a context cap but the practical limit on a huge prompt: Caddy `response_header_timeout 300s` / `read_timeout 900s` (`config/Caddyfile:88-105`), LiteLLM `timeout: 600` per deployment and `request_timeout: 600` (`config/litellm.yaml:71`, `:218`), edge deliberately has none (`edge/server.mjs:520-522`). A 900s Caddy read timeout will cut a genuinely long 1M-context generation — acceptable, and already the documented numeral.
4. **The client** — Claude Desktop's custom-model dialog has no context-window field; it assumes 200k for models it does not recognise. **Nothing the gateway can send fixes that** — it is a client-side default.

### 6. What is already documented for Claude Desktop / Claude Code

| Item | Where | Content |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `portal/components/docs/docs-data.ts:231-245` (`CLAUDE_ENV`, `CLAUDE_SETTINGS`) | `export ANTHROPIC_BASE_URL="https://api.zaino.soon.it/v1"`, `ANTHROPIC_AUTH_TOKEN="zn-…"`, `ANTHROPIC_MODEL="fast"`; the `~/.claude/settings.json` shape |
| `anthropic-version` | `portal/lib/connect/tools.ts:183-186,333-336` | the proving curl on `/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01` |
| Claude Code traps | `portal/lib/connect/tools.ts:189` | `ANTHROPIC_API_KEY` must be empty string, or Claude Code sends it instead of the auth token → 401 |
| Claude Code integration narrative | `portal/lib/changelog/entries.ts:136-138` | "zaino's Anthropic-compatible API … tool-use, extended thinking, multi-turn" |
| Anthropic wire format rationale | `docs/opencode-desktop.md:64-70` | `frontier`/`fable` use `@opencode/ai/providers/anthropic-compatible` → `/v1/messages`, because `chat/completions` strips image parts |
| **Claude Desktop specifically** | — | **Not documented.** `/connect` has a `claude-code` entry (`portal/lib/connect/tools.ts:49-54`) and an `anthropic-python` entry, but **no Claude Desktop entry**. `plans/linkedin-growth.md:510` is marketing copy, not setup docs. |
| Edge credential behaviour for Anthropic clients | `docs/auth-edge.md:88-96` | `curl -H "Authorization: Bearer zn-…" https://api.zaino.soon.it/v1/models`; both header styles work |

## Conclusions

- **The plumbing is done.** Claude Desktop pointed at `https://api.zaino.soon.it` with a `zn-` key will authenticate, stream, and get `/v1/messages` service today. The only missing piece is the four names.
- **`claude-*` must be a gateway-side routing name, not a product alias.** Adding it to `plans.models` / `TIER_ALIASES` / `usage_records` costs a migration, four portal allowlists and six failing tests, and creates a fifth tier in every dashboard. Mapping it in `config/litellm.yaml` costs one YAML block per model and touches no customer-facing surface.
- **1M is already live and already advertised on `/v1/models`.** The only gateway-side number that would actually stop a 1M-token request is Caddy's 10 MB body cap. Claude Desktop's own 200k assumption is not fixable from here.

## Minimum change — smallest set of edits, ranked

**1. `config/litellm.yaml` — add four `model_list` entries** (lines ~66-172, immediately after the four existing ones). Same `litellm_params` as their tier twin (`model: openai/haiku-5.5` etc., same `api_base`/`api_key`/timeouts/`reasoning_effort`/`verbosity`/`temperature`/`top_p`), same `model_info` verbatim (rates, `cache_*`, `max_input_tokens: 1048576`, `max_output_tokens: 65536`, `supported_endpoints`). Names: `claude-fast`, `claude-smart`, `claude-frontier`, `claude-fable`.

> Alternative to trial first, if you prefer 6 lines over 60: `router_settings.model_group_alias: {claude-fast: fast, claude-smart: smart, claude-frontier: frontier, claude-fable: fable}`. One curl on `/v1/messages` decides it. If it 400s, fall back to the four entries above. **Reason for the default recommendation:** the four-entry form is the only mechanism this repo demonstrably relies on over the Anthropic path (`docs/opencode-desktop.md:64-70`).

**2. `scripts/reconcile.sh:111-116` — add `"claude-fast": "haiku-5.5"` … to `ALIAS`.** Required by `portal/tests/pricing-consistency.test.ts:344-351` ("covers every alias the gateway serves"), which parses `litellm.yaml` and demands a mapping for every `model_name`. Without it the pricing suite fails.

**3. `docs/opencode-desktop.md` §"Two per-model exceptions" — one sentence** noting `claude-fast`/`claude-smart`/`claude-frontier`/`claude-fable` are the same deployments under a Claude-Desktop-facing name, aliases the ledger still records as `fast`/`smart`/`frontier`/`fable`. Keeps the doc (which is the spec for the catalog) truthful.

**4. *(only if 1M actually needs to be lifted past 10 MB in practice)* `config/Caddyfile:57-59` —** replace the blanket `request_body { max_size 10MB }` with a matcher pair, following the pattern already written and explained at `config/Caddyfile:150-190`:
```
@messages path /v1/messages
@notMessages not path /v1/messages
request_body @messages { max_size 24MB }
request_body @notMessages { max_size 10MB }
```
Ceiling stays under the edge's 32 MB (`edge/server.mjs:596`), so the edge is not the wall.

**Explicitly NOT in the minimum change:** `plans.models`, `api_keys.models`, `TIER_ALIASES`, `prices/models.yaml` `aliases:`, `usage_records` CHECK, `docs-data.ts` `TIERS`, `facts.ts` `RATES`, `aliases.ts` `ALIAS_ORDER`, `quota-meter.tsx`. All of them stay on the four tier aliases — that is what keeps the pool, the wall and the dashboard correct.

## Verification of the minimum change

Not implemented; the commands below are what a coder would run.

1. `make verify-config` — YAML parses, `config/litellm.yaml` included (`Makefile:281-306`).
2. `cd portal && npx vitest run tests/pricing-consistency.test.ts` — passes with the `reconcile.sh` entry, fails without it (this is the regression guard).
3. `make deploy HOST=gateway@<VPS_IP>` then, with a real key:
   ```
   curl -sS https://api.zaino.soon.it/v1/messages \
     -H "x-api-key: zn-…" -H "anthropic-version: 2023-06-01" \
     -H "Content-Type: application/json" \
     -d '{"model":"claude-fast","max_tokens":8,"messages":[{"role":"user","content":"reply with: ok"}]}'
   ```
   Expect `200` and `"model":"claude-fast"` or `"model":"haiku-5.5"` in the body.
4. `curl -sS https://api.zaino.soon.it/v1/models -H "Authorization: Bearer zn-…"` — confirm the `claude-*` entries carry `max_input_tokens: 1048576` and `max_output_tokens: 65536`.
5. After one request, confirm the ledger still reads `fast`: `make report USER=<slug> DAYS=1`, and `cd portal && npx vitest run tests/pricing-alias.test.ts` (asserts `toAlias` is idempotent on the four tier aliases).

## Open questions the investigation could not settle from the repo

- Whether LiteLLM `v1.103.1` allows a key whose `models:` allowlist names `fast` to call `claude-fast`, or whether the key must also list `claude-fast`. `docs/opencode-desktop.md:86-89` describes the wall as an allowlist of aliases; a second `model_name` per upstream is a *different* group and may be refused with the mapped 403 body (`edge/server.mjs:245-330`). **Test this with one key before shipping** — if it refuses, the fix is to push both names from `portal/lib/litellm/client.ts:291-313` (`allowlistFor`), not a change to the plan tables.
- Whether `router_settings.model_group_alias` resolves on `/v1/messages` in the pinned image. One curl settles it; that is why it is the trial-first option.
