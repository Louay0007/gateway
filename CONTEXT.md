# Zaino Gateway — Complete System Context

> Hand this document to another AI as its entire starting context. It is
> written to be self-sufficient: architecture, every non-obvious decision with
> its reason, the failure modes already hit, and what remains open.
>
> Last verified against production: **2026-10-15**, commit `527cd2e`.

---

## 1. What this system is

A multi-tenant LLM API gateway with metering and billing, selling three
product aliases — `fast`, `smart`, `frontier` — in front of eleven upstream
models. Customers hold a `zn-…` credential, call an OpenAI- or
Anthropic-compatible endpoint, and are billed per token with hard budget caps
enforced at the gateway. Payments are manual D17 bank transfers (La Poste
Tunisienne), verified by staff, not card payments.

Live production: `https://api.15-224-52-176.sslip.io/v1` (API) and
`https://portal.15-224-52-176.sslip.io` (dashboard), on a Lightsail VPS at
`15.224.52.176`.

**The single most important product invariant:** customers only ever see the
three aliases. No upstream model name is stored, rendered, or exported
anywhere in the customer surface — so the underlying model can be swapped
without it being a customer-visible change or a support conversation.

---

## 2. Request path

```
customer SDK
  → Caddy (TLS, public :80/:443)
  → auth-edge (node, 127.0.0.1:4001)  — rewrites zn- → sk-
  → LiteLLM (127.0.0.1:4000)           — auth, budgets, rate limits, routing
  → howtofix.id upstream                — https://api.howtofix.id/v1
```

Four container services plus datastores: `caddy`, `auth-edge`, `litellm`,
`portal` (Next.js), `jobs` (background worker), `postgres`, `redis`.
Only 22/80/443 are open in the Lightsail firewall; everything else is
loopback or bridge-network.

### Why auth-edge exists at all

Customers hold `zn-<body>`. LiteLLM stores `sk-<body>`. This is not a
cosmetic choice: LiteLLM's key normalizer in `proxy/_types.py` only hashes a
value that starts with `sk-`, so a `zn-` value is treated as an already-hashed
token and looked up verbatim, never matching. The prefix is *structural* to
the gateway and cannot live in the credential.

So the portal mints the random body (`portal/lib/keys/policy.ts` `mintKey`)
and `edge/server.mjs` restores the prefix on the request path. Forking LiteLLM
and Caddy-side rewriting were both evaluated and rejected on evidence.

`edge/server.mjs` design rules, in priority order: **fail closed** (unreachable
upstream is 502, never a synthetic 200 — a proxy that answers successfully
when the gateway did not is an unmetered request, the exact failure this
product exists to prevent); **never log a credential** (method, path, status,
duration and a boolean for prefix substitution — never the value, length or a
slice); **stream, or the product is broken** (no buffering, no content-length
on a streamed response); **bypass-free** (management surface denied at the
edge as defence in depth behind Caddy). No dependencies: `node:http` only.

**Internal callers bypass the edge** and must present `toGatewayKey()` —
`verify-metering` does, because it talks to LiteLLM's port directly and the
edge is not on that path. Sending `zn-` there yields a 401 that reads like a
broken key rather than a wrong door.

---

## 3. The Responses shim (the load-bearing unusual piece)

**codex-cli 0.156 speaks the OpenAI Responses API exclusively** — it dropped
`wire_api = "chat"`. The upstream serves `/v1/chat/completions` and
`/v1/messages` natively but returns **404 for `/v1/responses`**. LiteLLM does
not translate; it forwards, so the request 404s.

`edge/responses-shim.mjs` translates Responses → Chat, in-process inside
auth-edge, in front of LiteLLM.

**Why in front of LiteLLM and not behind it:** metering. LiteLLM prices and
logs `/v1/chat/completions`, which is the shape the upstream is actually
called in. Translating before LiteLLM keeps the money path on the one endpoint
LiteLLM already handles correctly, instead of inventing a second priced shape
that would need its own rates, ledger mapping, and proof.

The hard rules, each pinned by a test:

- **Reasoning NEVER becomes visible text.** `reasoning_content` maps to
  `response.reasoning_summary_text.delta` on its own reasoning item. Splicing
  it into `output_text.delta` would put the model's scratchpad inside the
  answer it is about to give.
- **A stream ALWAYS terminates on `response.completed`**, including when the
  upstream sent zero chunks — otherwise the client blocks until its own
  timeout.
- **`finish()` is idempotent.** An upstream that sends a terminal chunk and
  then closes must not produce two `response.completed` events.
- **An upstream error keeps its status.** A 429 becomes a 429, never a 200
  with an empty completion, which would make an agent believe the model
  answered.
- **Frames split on `\n\n`**, never a bare newline, so a frame split across a
  TCP segment is not corrupted. An unparseable frame is skipped, not fatal.
- **Refusals happen BEFORE the upstream call**, so a rejected request never
  spends a billable model call (asserted with a call counter).

`previous_response_id` is **refused with 400**, not silently dropped —
resolving it needs conversation state we don't keep, and dropping it would hand
the model a truncated history that still looks like success. Codex uses
`store:false` and sends full `input` each turn, so this shouldn't fire.

`RESPONSES_SHIM=off` restores pure passthrough.

---

## 4. Models and tiers

Upstream: **`https://api.howtofix.id/v1`**. The provider's own documented URL
(`https://howtofix.id/v1`) **404s from nginx** — the `api.` subdomain is
load-bearing.

| alias | deployments | nominal rate / Mtok |
|---|---|---|
| `fast` | nemotron-3.5-lightning, space-bunny, cat-jam, deepseek-v4.1-flash | $0.15 / $0.60 |
| `smart` | longcat-2.5-preview, mimo-v2.6, mimo-v2.6-flash, big-pickle | $0.30 / $1.20 |
| `frontier` | grok-4.6-liberated, muse-spark-1.3-contributor, muse-spark-1.2-contributor | $0.60 / $2.40 |

**Several deployments per alias is the point, not decoration.** With one
deployment under an alias, any failure is a 60-second outage: LiteLLM puts the
failed deployment in cooldown and reports "No deployments available … Try again
in 60 seconds" with nothing to fall through to. With 3–4, a rate-limited pool
is skipped and the next one serves.

Every deployment inside a tier carries **identical** rates, which keeps the
spend math deterministic regardless of which deployment served a request.
`verify-metering` and `scripts/reconcile.sh` both depend on that invariant.

**Tier membership is by MEASURED latency, not quality, because quality could
not be measured.** `scripts/probe-hard-tasks.py` first appeared to rank the
models (6/6 at the top, 4/6 at the bottom) — which would have been a usable
ranking. It was an artefact: two of its six checks used `^$` as a "forbidden"
pattern, and with `re.M` that matches ANY text ending in a newline, so nearly
every correct answer scored WRONG. With both fixed, all eleven tie 6/6 — twice
over. **Do not read `frontier` as "the best models"; it is the highest-priced
tier.** A real ranking needs SWE-bench Verified, not six regexes.

Admission gate (every model cleared it): tool calling with valid arguments,
the tool-result→answer turn, SSE framing, `/v1/messages`. Four were rejected —
`step-5-preview` (429 on every call), `mimo-v2.5` (400 on every call), and
`claude-haiku-5.5` + `deepseek-v4-flash`, which emit tool calls but **fail the
tool-result→answer turn**, so an agent stalls after its first call. That is
worse than not supporting tools at all.

**Prices are placeholders.** The provider publishes no pricing — `/v1/models`
has no `pricing` object and completions return no `usage.cost`. The rates exist
so the spend/budget/rollup pipeline stays exercisable (a $0 model makes every
budget a no-op and hides pipeline bugs) and so tiers differentiate. Replace with
real numbers before customer money depends on them.

Two rate tables must stay identical: `config/litellm.yaml` `model_info`
(per-token, consumed by LiteLLM) and `prices/models.yaml` (per-Mtok,
consumed by the portal and reconcile.sh). They have drifted before, silently,
in both directions. `portal/tests/pricing-consistency.test.ts` parses both from
disk and fails on any per-token disagreement, an unpriced deployment, an orphan
row, a tier whose members disagree, an endpoint the upstream lacks, or a
missing retry budget.

`/v1/responses` is deliberately **absent** from every `supported_endpoints` —
the upstream lacks it, and declaring it sends LiteLLM into a 404.

---

## 5. Billing

Plans: **Starter** `$19/mo` → `{fast, smart}`, 3 keys, 60 rpm, 200k tpm,
×1.30 multiplier. **Pro** `$99/mo` → `{fast, smart, frontier}`, 15 keys,
300 rpm, 1.5M tpm, ×1.25.

Both costs are stored per row — upstream and customer — because the gap *is*
the margin and storing one makes the business invisible.

The gateway tracks **upstream** budget while the cap is quoted in customer
dollars, so `resolveBudgetUsd()` divides by the multiplier: Starter's $100
customer cap becomes $76.92 upstream. An earlier version returned customer
dollars as an upstream budget and let a customer overspend by 30%.

### The key∩team model intersection bug (§5.26 — the one worth remembering)

LiteLLM resolves a key's effective access as the **intersection** of the key's
`models` and its **team's** `models`. `syncOrganizationEntitlements` pushed the
team's *budget* but never its *models* — it only set models on each key. A team
is created once with `DEFAULT_MODELS` and kept that list forever, so it
permanently narrowed every key beneath it.

Symptom: a key correctly scoped to `{fast,smart}` returned **403 "The
requested model 'smart' is not available for this API key"**, while
`GET /v1/models` returned `["fast","smart"]`. The message blames the key, which
sends the investigation at the wrong object.

It was invisible while every plan allowed exactly `["fast"]`, which matched
`DEFAULT_MODELS` by coincidence. **Widening a plan allowlist is what exposed
it.** Fixed: sync now calls `updateTeamModels`, `forceCut` cuts team models
too, `getTeamInfo` exists because until the team can be read back "key
mis-scoped" and "team stale" are indistinguishable, and `verify-metering`
asserts the **intersection** — asserting each list separately is what let it
ship.

Migration `0010` also forces every cached `entitlements` row due
(`synced_at` back 2 hours), because `planForOrg()` reads the cached row first
and only falls back to the live subscription. Without that, widening
`plans.models` changes nothing for an existing org for up to an hour.

---

## 6. Ledger, aliases and routes

`collect-usage.ts` resolves everything to customer-facing values **before**
writing:

- **model → alias**, preferring `model_group` (the alias the client requested,
  logged separately from the resolved upstream id) and falling back to the
  `aliases:` registry in `prices/models.yaml`. Either path yields an alias or
  `unknown`; a raw name cannot reach the ledger.
- **route → label**, from `call_type` (`acompletion`→`chat`,
  `anthropic_messages`→`messages`, `aresponses`→`responses`). Reading the
  legacy `endpoint` field is what produced 237 rows reading `unknown` — current
  spend rows do not carry it. Non-inference calls keep truthful labels.

Migration `0011` backfilled history (twenty distinct raw spellings → 4 values)
and added a **CHECK constraint** so the column can never hold anything else. A
deploy that writes an unmapped name now fails at the INSERT, loudly, instead of
silently rendering a provider's name on a customer dashboard.

`unknown` is the deliberate escape hatch for rejected attempts
(`__not_allowed__`), which have no model.

`portal/scripts/backfill-routes.ts` re-derived historical routes from LiteLLM's
spend table — a migration cannot join across two databases. Matches on
(team, exact timestamp, token counts); 237/237 matched, 0 ambiguous. Only
touches rows still reading `unknown`; idempotent. Dry-run by default, `--apply`
to write.

---

## 7. Code map

```
config/litellm.yaml          11 deployments over 3 aliases; read this file's
                             comments before changing tier membership
config/Caddyfile             TLS + routing; authoritative for mgmt denial
edge/server.mjs              auth-edge: zn-→sk-, /v1/responses interception
edge/responses-shim.mjs      pure translator, no I/O, importable in tests
prices/models.yaml           ONE table, TWO consumers + the `aliases:`
                             registry; nothing else declares tier membership
portal/lib/keys/policy.ts    key minting, prefix constants, plan allowlist
portal/lib/litellm/client.ts gateway API surface; shapes VARY by version —
                             every reader here is defensive by standing rule
portal/lib/entitlements/sync.ts  team+key limit push (see the bug above)
portal/lib/jobs/collect-usage.ts spend logs → ledger, alias+route resolution
portal/lib/pricing/alias.ts  toAlias / aliasForRow / routeForCallType
portal/db/migrations/        11 migrations, forward-only, explicit and audited
scripts/reconcile.sh         independent money-path implementation; wins on
                             disagreement because it runs against raw usage
```

178 TypeScript/TSX/MJS source files. 217 tests, 13 files.

---

## 8. How to prove it works

- `make verify-metering` — the end-to-end money-path proof: paywall →
  subscribe → use → upgrade → cancel@period-end → rollover cut → re-subscribe
  → usage series → cancel-now → revoke → delete account → rename → trial →
  admin suspend/reactivate/credit → anomaly scan → CSV export → trial expiry.
  Deterministic (mock upstream), re-runnable, restores the real upstream when
  it finishes. Run this after touching `lib/billing`, `lib/keys`, `lib/litellm`,
  `lib/jobs`, or provisioning.
- `make verify-d17` — the manual-payment path. **Currently cannot run**; see
  §10.
- `./scripts/smoke.sh <key>` — public-edge suite, `SMOKE_BASE=https://api…`.
- `cd portal && npm test` (217) and `npx tsc --noEmit`.
- `make verify-config` (13 checks) and `./scripts/scrub-check.sh`.

Deploy with `make deploy HOST=…` (rsync, excludes `.env`), then
`make db-migrate` and rebuild — **the portal and jobs images hold copies of
`lib/`; `make up` does not rebuild.**

**The mock upstream cannot start on a Linux VPS by default.** `node` does not
exist on the host, and the mock bound `127.0.0.1` while LiteLLM's container
reaches the host via `host.docker.internal` (the docker bridge gateway), which
cannot see loopback. The readiness probe was also `pgrep -f 'mock-upstream.mjs'`
— which matches the make command line itself and reports "already running" while
nothing listens. Now it curls `/health`, and `MOCK_HOST` is opt-in. On the VPS it
runs as a host-network container with `MOCK_HOST=0.0.0.0`.

---

## 9. Client configuration

```bash
export ZAINO_API_KEY='zn-hChpvtar5wZ-jXeU7E4XxnKmxsq0f7RQygfToCFYwQU'
codex -c model_provider=zaino -c model=fast
```

`~/.codex/config.toml` declares `[model_providers.zaino]` (base_url, `env_key`,
`wire_api = "responses"`) and `[models.fast]`, `[models.smart]`,
`[models.frontier]` with `model_context_window = 262144` and
`model_max_output_tokens = 32768`. Without the `[models.*]` entries Codex warns
"Model metadata for `fast` not found" and uses guessed fallback metadata.

The model override is **required** — Codex otherwise sends the global default
(`oc/step-5-preview-free`), which LiteLLM correctly rejects with 403.

The model is a **reasoning model**: it can spend an entire small
`max_output_tokens` budget on reasoning and return empty content. Tiny budgets
look like silent failure; use ≥1024.

Verified with codex-cli 0.156.1: prompt → `exec` tool call → result → correct
answer, and a multi-step run reading a file, writing a new one, executing it and
reporting the result.

---

## 10. Open items — do not skip these

1. **`D17_RECEIVER_PHONE` is unset; `make verify-d17` crashes.** The six
   `D17_*` keys were undocumented and absent from `.env.example` entirely. Now
   documented, with the merchant phone deliberately left blank — it is a real
   La Poste payout number, and a placeholder default invites a deploy that looks
   configured and is not. Only needed when `BILLING_PROVIDER=d17`.
2. **Four API keys were pasted in plaintext in this session.** Verified absent
   from the repo; they are in shell history and should be rotated.
3. **Prices are placeholders** (§4).
4. **An intermittent upstream 400 was never reproduced.** Observed twice with
   codex-cli against `fast`, ~1 in 150 on that path, absent from ~150 targeted
   attempts including 8 with the exact Codex shape. LiteLLM treats 400 as
   terminal and it is deliberately **not** retried: a bare 400 is
   indistinguishable from a genuinely malformed request, and retrying every one
   would turn a typo into six billable calls. If it matters, the fix belongs at
   the provider adapter — retry only a 400 whose body carries no
   `error.type`/`error.param`.
5. **Old Codex providers** (`9router`, `aipilot`, `flagshiprouter`) remain in
   `~/.codex/config.toml`; the default provider is still `9router`. Removing
   them breaks the default until you switch to `zaino`.

---

## 11. Traps — things that have already cost time

- **`data-horizontal:` in Tailwind expands to `[data-horizontal]`, but base-ui
  emits `data-orientation="horizontal"`.** The variant silently never matched,
  so every horizontal Tabs stayed `flex-row` and laid its tab list out *beside*
  the panel, stealing ~190px. It presented as a table-width bug and survived two
  rounds of plausible table edits. Fixed in `ui/tabs.tsx` (12 occurrences) and
  `ui/separator.tsx`. **Measure the ancestor chain with `getComputedStyle`
  before editing layout.**
- **LiteLLM's spend-log shapes vary by version.** Read every field defensively;
  that is the standing rule in `lib/litellm/client.ts`.
- **Raw `db.execute` SQL returns snake_case keys** (`occurred_at`), while the
  drizzle schema is camelCase. Reading the camelCase name yields `undefined`,
  which parses as `NaN` and makes a backfill match nothing while reporting no
  error.
- **The provider sits behind Cloudflare**, which returns `error code: 1010`
  (browser-signature ban) for Python's default `Python-urllib/3.x` User-Agent.
  Every model then looks like a hard 403. `curl` works. Send an explicit
  User-Agent from any Python probe.
- **`use_v2_migration_resolver` is NOT set** — enabling it would drop the
  SpendLogs table and lose all history.
- **Caddy does not reload on a bind-mounted Caddyfile change** — restart it.
- **`config/litellm.yaml` must never be round-tripped through
  `yaml.safe_dump`** — it destroyed ~152 comment lines once. Edit as text.

---

## 12. Working agreements

- Verify upstream capabilities by probing the live endpoint before wiring
  anything; never infer a provider's shape from documentation.
- Treat a green portal check as no evidence about what the *gateway* will do.
  Assert at the layer that enforces.
- When a probe passes everything, suspect the probe. Two "results" in this
  project's history were bugs in the measuring instrument.
- Prefer a refusal over a silent drop when an input field is unsupported.
  Dropping produces a 200 that looks fine while the work is wrong.
- `HANDOFF.md` (§5.1–§5.31) is the running engineering log with the full
  reasoning for each decision, the ones that were reverted, and why.
