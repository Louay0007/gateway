# AI HANDOFF — LLM Gateway repo (`/Users/user/Workspace/gateway`)

Read this file first. It is the complete, verified state of the project.
Everything below was confirmed live against the running stack, not assumed.

## 1. What this project is

A self-hosted **LLM gateway**: LiteLLM proxy (OpenAI + Anthropic wire
formats) in front of one upstream model, with a Next.js customer portal
(Auth.js, self-hosted — no Clerk), two Postgres databases (`litellm`
owned by LiteLLM, `portal` owned by us — never query LiteLLM's via SQL,
REST only), Redis, background jobs (usage collection, rollups,
entitlement reconcile), and Caddy as the TLS edge (VPS only).

Docs: `README.md`, `MASTER_PROMPT.md`, `DESIGN.md`, `IMPLEMENTATION.md`,
`PLATFORM.md`, `BLUEPRINT.md`, `LATENCY.md`. Ops entry: `Makefile`.

## 2. Environments (do not confuse them)

- **VPS = production.** SSH `gateway`, repo `/opt/gateway`, branch `main`.
  Caddy runs there (host networking, real domains, Let's Encrypt). The VPS
  holds exactly one thing git does not: `.env`.
- **Local = dev.** This folder. Caddy is NEVER run locally. Services are
  hit directly: gateway `http://127.0.0.1:4000`, portal
  `http://127.0.0.1:3000`. Local `.env` is gitignored and holds the dev
  tunnel key — never commit it, never print it.

## 3. Current live state (verified)

- Branch `main`, all services healthy (`litellm`, `portal` healthy,
  `postgres`, `redis`, `jobs` up). `make health` green:
  portal `/api/health` = `{"status":"ok","database":true,"gateway":true}`,
  `GET /health/readiness` on LiteLLM = 200 (no auth).
- **Single served model.** Alias `fast` →
  `openai/cl/cline-free/step-5-preview`. Upstream =
  `https://rj8dp52.abc-tunnel.us/v1` (dev tunnel, free tier, OpenRouter-style).
  Real requests verified on BOTH wire formats (`/v1/chat/completions` and
  `/v1/messages`), streaming confirmed. `/v1` is part of `api_base`, so
  `LITELLM_ANTHROPIC_DISABLE_URL_SUFFIX=true` is required.
- **Pricing invariant — "one table, two consumers."**
  `prices/models.yaml` (per-MTok) and `config/litellm.yaml` `model_info`
  (per-token) MUST agree. Verified equal for step-5-preview
  (input $0.30/MTok, output $1.20/MTok — nominal DEV rates, upstream is
  free; non-zero keeps spend/budget pipeline testable). Spend rows priced
  non-zero; budget enforcement proven live (call 1 → 200, call 2 → 429).
- **Data:** `usage_records=0`, `organizations=0`, `plans=4`.
- **Dev-only files (never deploy to VPS as-is):** `docker-compose.mock.yml`,
  `scripts/mock-upstream.mjs`, local `.env` pointing at the free tunnel.

## 4. Session history (commits on top of VPS `0848fba`, oldest → newest)

1. `9dc2f38` — stack bootable locally; management-route block moved from
   global `allowed_routes` to the Caddy `@mgmt` edge (global switch also
   blocked loopback `make key` + portal — architectural fix).
2. `a912c0e` — `SMOKE_BASE` override for local smoke; `issue-key.sh`
   stdout is pure pipeable JSON (guidance → stderr).
3. `ebbfa8f` — explicit per-token cost on ALL deployments (LiteLLM prices
   `openai/claude-*` at $0 → budgets were silently no-op); deterministic
   A-8 (bounded loop; key-spend cache lags one call), A-15 (sums
   authoritative `/spend/logs`, not lagging aggregates), A-12 (401 is a
   valid SSRF rejection), A-14 (edge-only; skipped on loopback).
4. `087b89f` — mock honors `cache_control` (A-6 deterministic);
   `reconcile.sh` reads the OSS spend ledger + re-prices aliases.
5. `b26cd5a` — single opencode `step-5-preview` model; portal probe
   `/health` → `/health/readiness`; prices + reconcile alias reconciled.
6. `45e903e` — usage pipeline fix: `getSpendLogs` sends `YYYY-MM-DD
   HH:MM:SS` (`/spend/logs/ui` 400s on date-only); new `extractUsage`
   reads LiteLLM v1.103.1 shape (top-level tokens +
   `metadata.usage_object.prompt_tokens_details`); reasoning tokens are
   NOT counted as cache reads. Collector rewired to it.

## 5. Known blocker + best next step

`usage_records` is empty **by design**, not by bug: the collector only
imports spend for orgs with a matching `litellm_team_id`, and no org/team
exists yet (no signup has happened in this DB). The pipeline code is fixed
and the jobs runner is healthy — it just has nothing it may import.

**Next step: prove metering end-to-end.** Create org (portal DB, with
`litellm_team_id`) → create matching LiteLLM team (`POST /team/new`) →
mint key on that team → real request → run collector once
(`make jobs-once` / `docker compose run --rm jobs … scripts/jobs.ts once`)
→ assert `usage_records` has the row with correct tokens + cost. The
Phase-2 usage dashboard and all billing depend on this. Use the real code
paths (`portal/lib/auth/provision.ts`, `portal/lib/keys/service.ts`,
`portal/lib/litellm/client.ts`), never hand-rolled SQL inserts.

## 6. Rules for any AI working here

- `.env` is gitignored. NEVER commit keys, NEVER print key values
  (lengths/redacted only). Run `make verify-config` + secret-scan before
  every commit.
- Don't run Caddy locally. Don't deploy local `litellm.yaml`/`.env` to
  the VPS — the tunnel + nominal prices are DEV-only. VPS deploys go via
  `make deploy HOST=…` (rsync, excludes `.env`), then migrate + rebuild.
- LiteLLM version pinned by behavior above (spend-log shape, `/ui`
  datetime contract, `reasoning_content`/`thinking` passthrough). If the
  image is upgraded, re-verify §5's assumptions first.
- Smoke: `SMOKE_BASE=http://127.0.0.1:4000 ./scripts/smoke.sh <key>`
  locally; A-14 only asserts over `https://` (public edge).
