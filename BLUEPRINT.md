# LLM API Gateway — Production Blueprint

**Status:** Draft for review
**Date:** 2026-10-11
**Scope:** Self-hosted, multi-tenant reverse proxy that fronts a third-party
Anthropic-compatible API, issues its own scoped API keys, and enforces per-key
token/cost limits with full usage attribution.

---

## Table of contents

1. [Goal and requirements](#1-goal-and-requirements)
2. [Legal and policy analysis](#2-legal-and-policy-analysis)
3. [Architecture](#3-architecture)
4. [Technology selection](#4-technology-selection)
5. [Request lifecycle](#5-request-lifecycle)
6. [Repository layout](#6-repository-layout)
7. [Configuration files](#7-configuration-files)
8. [Cost accounting](#8-cost-accounting)
9. [Limits and enforcement](#9-limits-and-enforcement)
10. [Usage attribution](#10-usage-attribution)
11. [Threat model](#11-threat-model)
12. [Fallback: custom proxy implementation](#12-fallback-custom-proxy-implementation)
13. [Deployment runbook](#13-deployment-runbook)
14. [Verification and acceptance tests](#14-verification-and-acceptance-tests)
15. [Operating costs](#15-operating-costs)
16. [Open decisions](#16-open-decisions)
17. [Sources](#17-sources)

---

## 1. Goal and requirements

### 1.1 The ask

> Given an upstream Anthropic-compatible endpoint (base URL + API key), stand up a
> gateway on my own domain and VPS that:
> - presents **its own base URL** pointing at the real one,
> - issues **its own API keys** that grant access to the underlying models,
> - allows me to build further APIs on top of the gateway,
> - enforces **per-user limits** with **per-token accounting**, attributed by
>   **IP** and by **endpoint**.

### 1.2 Functional requirements

| ID | Requirement | Notes |
|----|-------------|-------|
| F-01 | Client-facing HTTPS base URL | Auto-managed certificate |
| F-02 | Issue/rotate/revoke own API keys | Key = primary tenant identity |
| F-03 | Per-key model allowlist | Prevents a cheap key from calling an expensive model |
| F-04 | Per-key spend ceiling | Hard stop, not a warning |
| F-05 | Per-key RPM / TPM limits | Token bucket |
| F-06 | Per-key max concurrency | Protects against connection exhaustion |
| F-07 | Full token accounting | Input / output / cache-write / cache-read, split by TTL |
| F-08 | Cost computation | Per-model price table, current USD |
| F-09 | Attribution by endpoint | Route template, not raw path |
| F-10 | Attribution by client IP | Abuse signal, **not** identity |
| F-11 | Usage reporting API | Per key, per user, per endpoint, per model, per day |
| F-12 | Streaming passthrough | SSE must not be buffered |

### 1.3 Non-functional requirements

| ID | Requirement |
|----|-------------|
| N-01 | Upstream URL is **never** client-controllable (no SSRF) |
| N-02 | Upstream credential never appears in any response or log |
| N-03 | Administrative surface not reachable from the public API hostname |
| N-04 | All requests attributable to a stable identity |
| N-05 | Restorable — DB backups + documented key re-issue |
| N-06 | Runs on a single $5–10/month VPS |

### 1.4 Explicitly out of scope (v1)

- Billing/payment collection (cost tracking only, invoicing is a separate build)
- Multi-region / HA
- Response caching (LiteLLM supports it; it changes token economics and is a
  product decision, not infra)
- Semantic routing / model fallback across *different* upstream accounts

---

## 2. Legal and policy analysis

**This section is the first thing to read. A technically correct gateway is
worthless if the account gets terminated.**

### 2.1 What Anthropic's Commercial Terms actually say

Source: [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)
(effective 2025-06-17), sections A.1 and D.2.

**Permitted (§A.1):**

> "Anthropic gives Customer permission to use the Services, **including to power
> products and services Customer makes available to its own customers and end
> users**."

So building products on top of the API and serving your own users is
explicitly allowed. This is the normal, intended commercial use.

**Prohibited (§D.2):**

> "Customer may not and must not attempt to (a) access the Services to build a
> competing product or service, including to train competing AI models or
> **resell the Services except as expressly approved by Anthropic**; (b) reverse
> engineer or duplicate the Services; or (c) support any third party's attempt at
> any of the conduct restricted in this sentence."

### 2.2 The gateway pattern, classified

| Behaviour | Verdict | Why |
|---|---|---|
| Personal gateway, single user, self-issued key | ✅ Fine | §A.1 covers powering your own products |
| Gateway issuing keys to your own team / company users | ✅ Fine | "its own customers and end users" |
| Gateway reselling model access to the public as a service | ⚠️ Needs written approval | "resell the Services except as expressly approved" |
| Gateway sharing *one* upstream key across arbitrary third parties | ❌ Prohibited | Falls under resell + supporting a third party's restricted conduct |
| Gateway exposing upstream key directly to clients | ❌ Prohibited | Key sharing is separately restricted |

### 2.3 The stacked risk problem

If your upstream base URL is **not** `api.anthropic.com` — i.e. it is itself a
reseller or unofficial proxy — then that provider's own ToS is what governs
*them*, and you inherit whatever exposure they carry. Before deploying,
establish in writing:

1. Is the upstream an authorised reseller? (Ask them. Keep the answer.)
2. Does the upstream ToS permit *you* to build a downstream gateway?
3. Does your *own* ToS/privacy policy permit relaying prompts you never see?

If (1) or (2) is unclear, the acceptable risk is **private use only** — one
issued key, yourself, no third parties.

### 2.4 Consumer-plan keys are a different trap

If the upstream base URL you obtained came from a Claude.ai / claude.ai Pro/Max
*subscription* rather than a Console API key, the **Consumer** Terms apply
([claude.ai/legal](https://claude.ai/legal)):

> "You may not share your Account login information, your Anthropic API key, or
> your Account credentials with anyone else."

Anthropic has also moved toward restricting use of consumer OAuth tokens with
third-party agent tooling. **Use a Console API key. Do not build a gateway on a
subscription-derived credential.**

### 2.5 Data handling obligations

- Anthropic does **not** train on API Customer Content (§A.3). If your upstream
  is a third-party proxy, **you do not know that is true.**
- Prompt content never needs to reach your server. See §11.5 — design so that it
  doesn't. If it doesn't transit you, you have no privacy exposure for it.
- The **Usage and Cost API** (`/v1/organizations/usage_report/messages`) can give
  you per-key, per-workspace, per-model token breakdowns straight from Anthropic.
  Use it as an independent cross-check against your gateway's own ledger.

### 2.6 Decision gate

> **Do not deploy to third parties until §2.3 questions 1 and 2 are answered in
> writing.** Personal/team use can proceed immediately.

---

## 3. Architecture

### 3.1 Request path

```
        ┌──────────────────────────────────────────────────────────┐
        │  Internet                                                │
        └───────────────┬──────────────────────────────────────────┘
                        │ HTTPS :443
                        ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Caddy  (TLS termination, auto-cert)                    │
        │  • api.yourdomain.com  → gateway      [public]          │
        │  • admin.yourdomain.com → admin UI     [IP-allowlisted] │
        │  • trusted_proxies = Cloudflare CIDRs (if used)         │
        │  • flush_interval -1  (no SSE buffering)                │
        └───────────────┬──────────────────────────────────────────┘
                        │ HTTP :4000  (loopback only)
                        ▼
        ┌──────────────────────────────────────────────────────────┐
        │  LiteLLM Gateway                                         │
        │                                                          │
        │   1. authenticate virtual key   (Redis cache → Postgres) │
        │   2. authorize: model allowlist, route allowlist        │
        │   3. enforce: RPM / TPM / concurrency / budget          │
        │   4. route: model_name → deployment (api_base hardcoded)│
        │   5. forward with UPSTREAM_KEY injected                 │
        │   6. tee the stream; scrape usage on completion          │
        │   7. write spend log row + update budget counters       │
        └──────┬──────────────────────────────┬───────────────────┘
               │                              │
               │ outbound                     │ internal
               ▼                              ▼
   ┌────────────────────────┐   ┌──────────────────────────────────┐
   │ Upstream provider      │   │  PostgreSQL  (keys, spend logs,  │
   │ (base URL + real key)  │   │              budgets, teams)      │
   └────────────────────────┘   │  Redis      (key cache, rate     │
                                │              limit counters)     │
                                └──────────────────────────────────┘
```

### 3.2 Trust boundaries

| Boundary | Crossing | Control |
|---|---|---|
| Internet → Caddy | HTTPS | TLS 1.3, HSTS, rate limit, IP allowlist on admin |
| Caddy → LiteLLM | HTTP loopback | Never bind `0.0.0.0`; publish `127.0.0.1:4000` only |
| LiteLLM → Upstream | HTTPS | URL from env var; credential from env var |
| LiteLLM → Postgres/Redis | TCP | Docker-internal network, no published ports |
| Client → Upstream | — | **Never exists.** Gateway is the only egress path. |

### 3.3 Why the gateway must be the only egress path

If any client can reach the upstream directly, every control in this document
becomes advisory. Enforce this with a VPS firewall:

```bash
# Allow only what the gateway needs
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH  (restrict to your IP — see §13.6)
ufw allow 80/tcp        # ACME HTTP-01 challenge
ufw allow 443/tcp       # HTTPS
ufw enable
```

---

## 4. Technology selection

### 4.1 Gateway comparison (as of 2026-10)

| Option | Language | Self-host | Governance | Throughput | License | Verdict |
|---|---|---|---|---|---|---|
| **LiteLLM** | Python | ✅ | Full (keys, budgets, teams, spend logs, admin UI) | Python-bound at high RPS | OSS / Enterprise | ✅ **Recommended** |
| **Bifrost** (Maxim AI) | Go | ✅ | Core: virtual keys, budgets | Microsecond routing overhead | OSS | Good if RPS > ~200 |
| **LLM Gateway** | — | ✅ (or managed) | Full | — | AGPLv3 | AGPL copyleft — read before adopting |
| **Portkey → Prisma AIRS** | TypeScript | Partial | Deep | High | Acquired by Palo Alto, May 2026 | Enterprise path changed |
| **Cloudflare AI Gateway** | — | ❌ (managed) | Analytics, caching, rate limits | Edge | Proprietary | Fine for visibility, not self-hosting |
| **Helicone Gateway** | TypeScript | ✅ | — | — | Acquired by Mintlify, Mar 2026 | ⚠️ Maintenance mode |
| **Kong AI Gateway** | Lua/Go | ✅ | Plugins | High | OSS + Enterprise | Only if you already run Kong |
| **Custom** | Your choice | ✅ | You build it | You control it | Yours | Only if §12 justifies it |
| **Nginx only** | — | ✅ | None (static keys only) | Excellent | — | Insufficient for per-key budgets |

**Decision: LiteLLM.** It is the only option where per-key budgets, TPM/RPM,
model allowlists, and spend logs are all in the free OSS core. Bifrost is the
upgrade path if you outgrow Python's concurrency.

### 4.2 Supporting stack

| Concern | Choice | Rationale |
|---|---|---|
| TLS / edge | Caddy | Automatic ACME, no certbot timers |
| Database | PostgreSQL 16+ | **Required.** LiteLLM budgets do not work without it |
| Cache / limiter | Redis 7+ | Required once > 1 replica; useful from day 1 |
| Config | `config.yaml` + `.env` | Secrets never in the YAML |
| Backups | `pg_dump` + cron | N-05 |

> ⚠️ **Critical:** `litellm_settings.max_budget` is **not** a spend cap without a
> database configured. Without Postgres, every budget field is silently ignored.
> This is the single most common misconfiguration.

---

## 5. Request lifecycle

Per LiteLLM's documented proxy architecture:

1. **Client sends request** with `Authorization: Bearer sk-<your-key>`.
2. **Auth** — key looked up in Redis; on miss, Postgres. Rejected if unknown,
   expired, or over budget.
3. **Rate limit** — parallel limiter evaluates limits at four scopes
   independently: global server, key, user, team.
4. **Route** — `model` in the body is matched against `model_name` in
   `model_list`, producing a deployment. The upstream `api_base` for that
   deployment comes from config, never from the request.
5. **Forward** — upstream credential injected from environment.
6. **Post-request** — after the response is delivered:
   - spend/usage counters updated for key, user, team, server,
   - `_ProxyDBLogger` writes a spend-log row to Postgres.

```
 Client ──► [1 Auth] ──► [2 Rate Limit] ──► [3 Router] ──► [4 Upstream call]
                                                                    │
 Client ◄──────────────────────── SSE stream (unbuffered) ◄─────────┘
                                                                    │
                              [5 Log spend] ◄────────────────────────┘
                              [6 Update counters]
```

**Critical path for streaming:** LiteLLM sends the response to the client while
asynchronously parsing usage. Do not put anything in between that buffers.

---

## 6. Repository layout

```
gateway/
├── BLUEPRINT.md                 # this document
├── docker-compose.yml
├── .env                         # secrets — gitignored, chmod 600
├── .env.example                 # template, safe to commit
├── config/
│   ├── litellm.yaml             # gateway config
│   └── Caddyfile                # edge config
├── prices/
│   └── models.yaml              # your price table (§8.4)
├── scripts/
│   ├── issue-key.sh             # mint a tenant key
│   ├── report.sh                # usage reports
│   └── backup.sh                # nightly pg_dump
└── docs/
    ├── RUNBOOK.md
    └── INCIDENT-UPSTREAM-KEY-LEAK.md
```

---

## 7. Configuration files

### 7.1 `.env`

```bash
# ── Gateway credentials ───────────────────────────────────────────
# MASTER key authorises management API + Admin UI. NEVER issue to clients.
LITELLM_MASTER_KEY=sk-$(openssl rand -hex 32)

# SALT encrypts provider credentials stored in the DB.
# Set once. Changing it makes every stored credential unreadable.
LITELLM_SALT_KEY=sk-$(openssl rand -hex 32)

LITELLM_MODE=PRODUCTION   # disables auto-loading a stray .env

# ── Upstream (the real provider) ───────────────────────────────────
UPSTREAM_BASE_URL=https://api.anthropic.com
UPSTREAM_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx

# ── Datastores ─────────────────────────────────────────────────────
DATABASE_URL=postgresql://litellm:${POSTGRES_PASSWORD}@postgres:5432/litellm
REDIS_URL=redis://redis:6379

# ── Global safety rails ────────────────────────────────────────────
LITELLM_MAX_GLOBAL_BUDGET=500      # USD, across all keys. Kill switch.
```

```bash
chmod 600 .env
echo '.env' >> .gitignore
```

### 7.2 `config/litellm.yaml`

```yaml
model_list:
  # ── Upstream deployment ─────────────────────────────────────────
  # model_name  = what clients ask for
  # model       = how LiteLLM talks to the provider
  # api_base    = env var → NOT client-controllable (satisfies N-01)
  # api_key     = env var → never visible in the Admin UI
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-5
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY

  - model_name: claude-opus
    litellm_params:
      model: anthropic/claude-opus-4-1
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY

  # ── Naming alias: expose your own model names, not theirs ───────
  # Clients ask for "fast" / "smart"; you control the mapping and can
  # change the backing model later without touching client code.
  - model_name: fast
    litellm_params:
      model: anthropic/claude-sonnet-4-5
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY

  - model_name: smart
    litellm_params:
      model: anthropic/claude-opus-4-1
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY

litellm_settings:
  request_timeout: 600
  num_retries: 2
  # Return 429 instead of 402 when a budget is exhausted.
  budget_exceeded_status_code: 429

  drop_params: true   # strip params the upstream rejects instead of erroring

  success_callback: ["prometheus"]
  failure_callback: ["prometheus"]

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL

  store_model_in_db: true

  # ── Privacy: do NOT persist prompt/response content ─────────────
  # Off by default. Turn on only if you need content-level debugging,
  # and understand you are now storing user prompts in your Postgres.
  store_prompts_in_spend_logs: false

  # ── Retention: keep the ledger bounded ──────────────────────────
  maximum_spend_logs_retention_period: "90d"

  # ── Hardening: only expose the endpoints you actually serve ──────
  allowed_routes:
    - "/v1/chat/completions"
    - "/v1/messages"
    - "/v1/models"
    - "/health"

  # ── ABUSE / ATTRIBUTION ─────────────────────────────────────────
  # Trust a client IP only from your own edge.
  # NEVER set trusted_proxies to 0.0.0.0/0 unless the origin is
  # unreachable other than through your proxy. See §11.2.
  # client_ip_headers CF-Connecting-IP X-Forwarded-For X-Real-IP

router_settings:
  routing_strategy: usage-based-routing-v2
  redis_host: os.environ/REDIS_HOST
  redis_port: os.environ/REDIS_PORT

# ── Bootstrap keys (optional) ─────────────────────────────────────
# Prefer minting keys via /key/generate at runtime (see §7.5) so that
# you never store plaintext tenant keys in git.
key_list: []
#  - key: "sk-bootstrap-..."      # rotate immediately after first use
#    key_name: "bootstrap-admin"
#    models: ["claude-sonnet", "claude-opus", "fast", "smart"]
#    max_budget: 10.0
#    budget_duration: "30d"
#    rpm_limit: 60
#    tpm_limit: 100_000
#    max_parallel_requests: 5
```

**About `allowed_routes`:** it removes endpoints you don't need — `/key/generate`,
`/user/new`, `/spend/*`, `/config/*` — from the public attack surface. If you
never proxy to a third URL, you never need the management API on the public
hostname at all. §7.4 enforces this at the edge.

### 7.3 `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
      POSTGRES_DB: litellm
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm"]
      interval: 10s
      timeout: 5s
      retries: 5
    # no published ports — internal network only

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD:?set in .env}
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  litellm:
    # Pin an exact release tag. Never :latest in production — it makes
    # rollbacks non-deterministic.
    image: ghcr.io/berriai/litellm:v1.98.0
    restart: unless-stopped
    command:
      - "--config=/app/config.yaml"
      - "--num_workers=1"
      - "--port=4000"
    environment:
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:?set in .env}
      LITELLM_SALT_KEY: ${LITELLM_SALT_KEY:?set in .env}
      LITELLM_MODE: PRODUCTION
      DATABASE_URL: postgresql://litellm:${POSTGRES_PASSWORD}@postgres:5432/litellm
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set in .env}
      UPSTREAM_BASE_URL: ${UPSTREAM_BASE_URL:?set in .env}
      UPSTREAM_API_KEY: ${UPSTREAM_API_KEY:?set in .env}
      STORE_MODEL_IN_DB: "True"
    volumes:
      - ./config:/app/config:ro
    ports:
      # Loopback only. This is the single most important line in the file.
      - "127.0.0.1:4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    environment:
      API_DOMAIN: ${API_DOMAIN:?set in .env}
      ADMIN_DOMAIN: ${ADMIN_DOMAIN:?set in .env}
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - litellm

volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
```

```bash
printf 'POSTGRES_PASSWORD=%s\nREDIS_PASSWORD=%s\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" >> .env
```

### 7.4 `config/Caddyfile`

```caddyfile
{
    email you@yourdomain.com

    # ONLY enable these two lines if the origin is unreachable except
    # through Cloudflare. Without them, X-Forwarded-For is spoofable.
    #
    # trusted_proxies static <cloudflare CIDR list>
    # client_ip_headers CF-Connecting-IP X-Forwarded-For X-Real-IP
    #
    # Refresh the CIDR list periodically — it changes.
}

# ── Public API ─────────────────────────────────────────────────────
{$API_DOMAIN} {
    encode zstd gzip

    # Reject oversized bodies before they reach the gateway.
    request_body {
        max_size 10MB
    }

    reverse_proxy 127.0.0.1:4000 {
        # F-12 / §11.1. Low-latency mode: flush after every write.
        # Required for SSE. (Caddy also auto-detects
        # Content-Type: text/event-stream and unknown Content-Length,
        # but set this explicitly — do not rely on inference.)
        flush_interval -1

        # Long streams must not be cut off mid-generation.
        transport http {
            dial_timeout 10s
            response_header_timeout 120s
            read_timeout 900s
            write_timeout 900s
        }
    }

    log {
        output stdout
        format json
        # Log the real client IP, not a spoofable header.
        # Caddy writes "client_ip" only when trusted_proxies is correct.
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        -Server
    }
}

# ── Admin UI + management API ──────────────────────────────────────
# Gated to your own IPs. Default-deny.
{$ADMIN_DOMAIN} {
    @blocked not remote_ip 127.0.0.1/32 ::1 203.0.113.4/32
    respond @blocked "Forbidden" 403

    reverse_proxy 127.0.0.1:4000 {
        flush_interval -1
        transport http {
            read_timeout 900s
            write_timeout 900s
        }
    }
}
```

> **Why a separate admin host.** LiteLLM's management endpoints (`/key/generate`,
> `/spend/*`, `/config/*`) are authenticated by the master key, but serving them
> on the same hostname your API keys are minted from means a single leaked
> master key is one HTTP request from total compromise. Splitting hosts means
> compromise of the public host yields nothing.

### 7.5 Minting a tenant key

```bash
#!/usr/bin/env bash
set -euo pipefail
# scripts/issue-key.sh <alias> <models-csv> <max-budget-usd> <duration>

ALIAS="${1:?alias required}"
MODELS="${2:?models csv required}"
BUDGET="${3:?max budget usd required}"
DURATION="${4:?duration e.g. 30d required}"

curl -sS -X POST 'http://127.0.0.1:4000/key/generate' \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{
        \"key_alias\":   \"${ALIAS}\",
        \"models\":      [$(echo "$MODELS" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/')],
        \"max_budget\":  ${BUDGET},
        \"budget_duration\": \"${DURATION}\",
        \"rpm_limit\":   60,
        \"tpm_limit\":   100000,
        \"max_parallel_requests\": 5,
        \"metadata\":    { \"issued_by\": \"ops\", \"owner\": \"${ALIAS}\" }
      }" | jq '{key: .key, expires: .expires}'
```

Test the issued key immediately — see §14.

### 7.6 Client configuration

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://api.yourdomain.com/v1",   # your base URL
)

r = client.chat.completions.create(
    model="fast",                               # YOUR alias, not the real model
    messages=[{"role": "user", "content": "hello"}],
)
```

Native Anthropic SDK works too — point it at your domain:

```bash
export ANTHROPIC_BASE_URL=https://api.yourdomain.com
export ANTHROPIC_AUTH_TOKEN=sk-your-issued-key
export ANTHROPIC_MODEL=fast
export ANTHROPIC_SMALL_FAST_MODEL=fast
```

---

## 8. Cost accounting

### 8.1 The four token classes

Every Anthropic-format response carries:

```json
"usage": {
  "input_tokens": 3,
  "output_tokens": 10,
  "cache_creation_input_tokens": 23566,
  "cache_read_input_tokens": 19357,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 23566
  }
}
```

Counting only `input_tokens` at face value under-reports cached Claude traffic
dramatically. A request that is 95% cache-read is billed at ~10% of the input
rate, not 100%.

### 8.2 Cache pricing multipliers

| Operation | Multiplier | Duration |
|---|---|---|
| Base input | 1.0× | — |
| Cache **write** (5-min TTL) | **1.25×** | 5 minutes (default) |
| Cache **write** (1-hour TTL) | **2.0×** | 1 hour |
| Cache **read** | **0.1×** | matches preceding write |

**Per-model exceptions exist.** Recent Claude releases carry read rates of
0.025× (some Fable-class models) and 0.05× (Opus 5.5). Read the footnote on the
live pricing page — do not hardcode 0.1×.

Multipliers stack with other modifiers (Batch API discount, data residency).

### 8.3 The TTL bug you will otherwise ship

`cache_creation_input_tokens` is a **single combined field**. If you price all
of it at the 5-minute rate (1.25×), you under-bill any workload that uses 1-hour
caching.

This is a documented real-world failure. The `ccusage` project shipped exactly
this bug; a maintainer's analysis of ~40k records found **19% aggregate
under-reporting** ($2,568 reported vs $3,047 actual), with 92% of cache-creation
tokens on 1-hour TTL for Opus 4.6:

| Model | Reported (all @1.25×) | Correct (split) | Under |
|---|---|---|---|
| claude-opus-4-6 | $2,388 | $2,826 | 18% |
| claude-haiku-4-5 | $112 | $135 | 21% |
| claude-sonnet-4-5 | $46 | $63 | 38% |
| **Total** | **$2,568** | **$3,047** | **19%** |

**Rule: always read `cache_creation.ephemeral_5m_input_tokens` and
`ephemeral_1h_input_tokens` separately. If the breakdown is absent, fall back to
the 5-minute rate and flag the record as unpriced-precise.**

### 8.4 Price table

Keep it in version control, separate from the gateway config, reviewed on a
schedule. **Do not hardcode absolute prices from this document** — pull them from
the provider's live pricing page.

```yaml
# prices/models.yaml
models:
  claude-sonnet-4-5:
    input_per_mtok:        3.00
    cache_write_5m_per_mtok:  3.75    # 1.25x
    cache_write_1h_per_mtok:  6.00    # 2.00x
    cache_read_per_mtok:      0.30   # 0.10x
    output_per_mtok:       15.00

  claude-opus-4-1:
    input_per_mtok:         15.00
    cache_write_5m_per_mtok:  18.75
    cache_write_1h_per_mtok:  30.00
    cache_read_per_mtok:       1.50
    output_per_mtok:        75.00

# Long-context tiers: some models price above a context threshold
# differently. Add explicitly when applicable rather than approximating.
```

### 8.5 Computation

```python
def compute_cost(usage: dict, price: dict) -> float:
    cc = usage.get("cache_creation", {}) or {}
    w5 = cc.get("ephemeral_5m_input_tokens", 0)
    w1 = cc.get("ephemeral_1h_input_tokens", 0)

    # If the TTL breakdown is missing, fall back to the 5m rate.
    if usage.get("cache_creation_input_tokens") and not (w5 or w1):
        w5 = usage["cache_creation_input_tokens"]

    M = 1_000_000
    return (
        usage.get("input_tokens", 0)              / M * price["input_per_mtok"]
      + w5                                        / M * price["cache_write_5m_per_mtok"]
      + w1                                        / M * price["cache_write_1h_per_mtok"]
      + usage.get("cache_read_input_tokens", 0)   / M * price["cache_read_per_mtok"]
      + usage.get("output_tokens", 0)            / M * price["output_per_mtok"]
    )
```

> **LiteLLM caveat.** LiteLLM maintains its own cost map and applies a single
> `cache_creation_input_token_cost`. It may apply the 5-minute rate to all cache
> creation. Validate LiteLLM's reported spend against your own §8.5 computation
> on a sample of 100 real requests before trusting its numbers for invoicing
> anyone.

### 8.6 Pre-flight estimation

For hard budget enforcement *before* spending:

- Anthropic exposes `POST /v1/messages/count_tokens`. It is **free** and has
  **rate limits independent of** message creation, so calling it on every
  request does not consume your generation quota.
- LiteLLM proxies it at `/v1/messages/count_tokens`, and passes through natively
  at `/anthropic/v1/messages/count_tokens`.
- Documented as an **estimate** — always reconcile against post-hoc actuals.

Strategy: estimate pre-flight to reject obviously-over-budget callers; record
actual post-hoc for billing.

---

## 9. Limits and enforcement

### 9.1 The five limit types

| Limit | Field | Protects against |
|---|---|---|
| Requests/min | `rpm_limit` | Flooding, brute-force probing |
| Tokens/min | `tpm_limit` | **Wallet drain** — the one that actually matters |
| Concurrency | `max_parallel_requests` | Connection exhaustion, runaway agents |
| Spend per window | `max_budget` + `budget_duration` | **Slow-burn drain** |
| Model access | `models` | A cheap key calling an expensive model |

### 9.2 Why rate limits alone are insufficient

A caller at 1 request every 10 seconds never trips an RPM limit, but at 50k
tokens/request that is ~$0.75/minute, ~$1,080/day. **Only a spend ceiling stops
this.** Always configure `max_budget` with `budget_exceeded_status_code: 429`.

Use `soft_budget` for alerting without blocking.

### 9.3 Budget window syntax

```
30s   5m    1h    7d    30d    1mo
```

Explicit `"budget_duration": null` creates a **never-resetting** budget.

### 9.4 Precedence

LiteLLM applies the **most specific** limit. From the parallel limiter source,
a limit dimension set to `0` disables that dimension:

```python
if (max_parallel_requests == 0 or tpm_limit == 0 or rpm_limit == 0):
    # ... 0 means "unlimited" for that dimension
```

`0` = unlimited. `null`/absent = inherit. Never assume 0 is "deny".

### 9.5 Global kill switch

```yaml
litellm_settings:
  max_budget: 500.0   # USD, all providers, whole instance
  max_internal_user_budget: 50.0
```

---

## 10. Usage attribution

### 10.1 The identity hierarchy

```
1. issued API key   → authoritative identity. Quotas, budgets, billing.
2. end-user id      → optional sub-attribution within one key's traffic.
3. client IP        → abuse signal ONLY. Never bill on it.
```

### 10.2 Why IP is not an identity

- Carrier NAT / CGNAT: thousands of subscribers share one public IP.
- Corporate NAT: an entire office shares one IP.
- Mobile: one user rotates IPs constantly.
- VPN: one user appears from arbitrary addresses.

Billing on IP produces both false positives (legitimate user throttled) and
false negatives (attack billed to a random neighbour).

**Use IP for:** flood control, geo-anomaly detection, per-source abuse counters.
**Never use IP for:** quota attribution, billing, access decisions about an
individual.

### 10.3 The user-id evasion trap

LiteLLM documents this explicitly:

> "End users can provide the `user` parameter in their request bodies... users
> could 'avoid' having their spend tracked... you must always set `user_id` when
> creating their api keys."

**Consequence:** if you hand keys directly to end users, they can move their
spend to an arbitrary `end_user_id` with a one-line body change. Two mitigations:

1. Set `user_id` on every key at creation, and pin it — never let the request
   body choose.
2. Add a LiteLLM custom-auth hook that strips/overrides body-supplied `user`.
3. Restrict body-supplied `user` via `extra_spend_tag_headers` allowlist.

### 10.4 Per-endpoint attribution

Tracked automatically. LiteLLM's **Endpoint Activity** records token counts,
spend, status, and timestamp per endpoint (`/chat/completions`, `/messages`, …),
viewable under **Usage → Endpoint Activity** in the Admin UI.

> **Do not expect the two Usage sources to tie out.** Gateway request counts are
> counted by the proxy itself; the per-key/per-model/per-tag panels read daily
> spend rollups written *after* a request completes. A spend-log row only exists
> for a request that got far enough to be logged, and each upstream *attempt* is
> recorded separately. They answer different questions. Reconcile deliberately,
> and document the expected delta rather than chasing it.

### 10.5 Endpoint access control

Use `tag`-based spend attribution for per-application tracking:

```yaml
litellm_settings:
  extra_spend_tag_headers:
    - "x-app-id"        # your own header, injected by your services
```

Clients cannot forge this if the gateway strips it from inbound requests and
your backend services set it.

### 10.6 Reporting API

```bash
# Per-user spend
curl -s "http://127.0.0.1:4000/user/info?user_id=acme" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" | jq

# Per-key spend
curl -s "http://127.0.0.1:4000/key/info" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" | jq '.spend'

# Daily activity breakdown (derived from spend logs)
curl -s "http://127.0.0.1:4000/user/daily/activity?user_id=acme" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" | jq

# Budget remaining (Prometheus metric)
# litellm_remaining_team_budget{team_alias="...", team_id="..."}
```

**Access control on `/spend/*` (default):**

| Caller role | `/spend/keys` | `/spend/users` |
|---|---|---|
| `proxy_admin` / `proxy_admin_viewer` | All keys | All users (or `?user_id=`) |
| `internal_user` / `internal_user_view_only` | Own keys only | Own row only |
| No `user_id` on key | `[]` | `[]` |

Never hand a client the master key to "let them see their own usage." Mint them
a key scoped to their own `user_id` instead.

### 10.7 Independent cross-check

Anthropic's Usage and Cost API reports token consumption by API key, workspace,
model, and service tier:

```
GET /v1/organizations/usage_report/messages
    ?starting_at=...&ending_at=...&bucket_width=1d
```

Granularity limits: `1m` → max 1440 buckets, `1h` → max 168, `1d` → max 31.

Run this monthly and diff against your gateway ledger. Any systematic drift
means your price table or TTL handling is wrong.

---

## 11. Threat model

### 11.1 SSE buffering — the most common breakage

If the proxy buffers, streaming clients hang or receive the entire response at
once. Symptoms: TTFT (time to first token) reported as 30s on a request that
actually generated in 2s.

Caddy's `flush_interval -1` disables buffering. Caddy also auto-flushes when the
response is `Content-Type: text/event-stream` or Content-Length is unknown — but
**set it explicitly** rather than depending on inference.

Nginx equivalent (if you use it):

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 900s;
```

### 11.2 X-Forwarded-For spoofing — the one that silently voids your IP limits

**The attack:**

```bash
curl https://api.yourdomain.com/v1/messages \
  -H "X-Forwarded-For: 1.2.3.4" \
  -H "Authorization: Bearer sk-leaked"
```

If your gateway reads the **left-most** XFF entry, the caller picks their own
identity and every IP-based limit is bypassed permanently.

**This is a real, exploited vulnerability class — not theoretical:**

- **CVE-2023-50463** — caddy-geo-ip's `trust_header X-Forwarded-For` allowed
  spoofing the source IP to bypass IP-range restrictions.
- **CVE-2024-21494** — caddy-security authentication bypass via spoofed XFF in
  the `/whoami` identity module.
- **GHSA-73p3-rqpv-59wx** (HestiaCP, 2026-07) — trusted `CF-Connecting-IP`
  from any client without verifying Cloudflare origin, bypassing fail2ban, IP
  allowlists, and poisoning audit logs.

**Mitigations, in order of preference:**

1. **Don't terminate at Cloudflare at all.** A single small VPS serving a
   handful of tenants does not need a CDN. Direct A→VPS means the TCP peer IP is
   the client IP. Simplest and strongest.
2. **If you must use Cloudflare:** set Caddy `trusted_proxies` to Cloudflare's
   published CIDR ranges (refreshed periodically — they change), set
   `client_ip_headers CF-Connecting-IP`, **and** firewall the origin so port 443
   is reachable *only* from Cloudflare ranges. All three. Any one alone is
   insufficient.
3. **Caddy caveat:** Caddy takes the **left-most** XFF entry, which is the least
   trustworthy position. With correct `trusted_proxies` this is safe because
   untrusted inbound values are stripped. It is not safe with
   `trusted_proxies 0.0.0.0/0` unless the origin is genuinely unreachable
   except through the proxy.
4. Authenticated Origin Pulls (client cert from Cloudflare) as an alternative
   to CIDR allowlisting.

**Never:** `trusted_proxies 0.0.0.0/0` on an internet-reachable origin.

### 11.3 SSRF via client-controlled upstream

If any request field reaches `fetch()` as a URL, you have an SSRF hole into your
VPS's network — including `localhost`, the Docker bridge, and the cloud metadata
endpoint (`169.254.169.254`, which on most VPS providers hands out IAM
credentials).

**Controls:**

- `api_base` comes only from `os.environ/UPSTREAM_BASE_URL`. Never from a
  request field, header, or query parameter.
- No generic "proxy this URL" endpoint. Ever.
- Drop `base_url` / `api_base` / `api_key` params from inbound bodies via
  LiteLLM `drop_params`.
- Cloud metadata blocked at the network layer where possible.

### 11.4 Credential leakage

| Vector | Control |
|---|---|
| Error messages echoing upstream auth | Sanitise; test with an invalid key first |
| `api_key` in config shown in Admin UI | Always `os.environ/VAR`, never a literal |
| Env vars leaking via `/proc` | Dedicated unprivileged user for the gateway |
| Logs containing request headers | Configure redaction; never log `Authorization` |
| `docker inspect` exposing env | Use Docker secrets or an env file with `0600` |
| Provider creds in Postgres | Encrypted by `LITELLM_SALT_KEY`. **Back up the salt key.** |

> Losing `LITELLM_SALT_KEY` makes every provider credential stored in the
> database permanently unreadable. Back it up separately from the DB dump, or
> you must re-enter every credential after a restore.

### 11.5 Prompt content should not transit your server

Architecturally the gateway sees full prompts and completions. It does not have
to retain them.

- `store_prompts_in_spend_logs: false` (the default) stores token counts only.
- If you need content for debugging, use short retention, and document that you
  are now a data processor for your users' content.

This is the difference between "we proxy API calls" and "we handle user data."

### 11.6 Resource exhaustion

| Risk | Control |
|---|---|
| Request body flood | Caddy `request_body { max_size 10MB }` |
| Slowloris | Caddy defaults; tune `read_timeout` |
| Many long-lived streams | `max_parallel_requests` per key |
| Postgres connection exhaustion | LiteLLM defaults; add Redis buffering above ~1000 rps |
| Log table growth | `maximum_spend_logs_retention_period` |

### 11.7 Mass key issuance

If the Admin UI is reachable from the internet, a leaked or brute-forced master
key mints unlimited tenant keys — including ones for models you did not intend
to expose. §7.4's IP-allowlisted admin host plus `allowed_routes` is the
mitigation.

---

## 12. Fallback: custom proxy implementation

Choose this only if you need behaviour LiteLLM cannot express: a bespoke auth
scheme, non-token billing (per-seat/per-request), or transformation LiteLLM
mangles.

### 12.1 When it is justified

| Requirement | LiteLLM? |
|---|---|
| Per-key budgets, RPM/TPM, model allowlists, spend logs | ✅ Built in — don't rebuild |
| Custom tokenisation / non-standard metering | ❌ |
| Seat-based licensing mixed with usage | ❌ |
| Extreme single-digit-millisecond routing overhead | ❌ — use Bifrost (Go) |
| Full control of header semantics per upstream | ⚠️ possible but fiddly |

If your reason is "I want to understand it completely," read this section, then
use LiteLLM anyway and spend the saved time on pricing correctness.

### 12.2 Minimum viable proxy

```go
// cmd/gateway/main.go — sketch, not production code.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

type usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

// auth is the ONLY source of upstream configuration.
// Nothing in the request may influence the target.
func auth(r *http.Request) (*http.Request, bool) {
	key := r.Header.Get("Authorization") // Bearer sk-...
	rec, ok := lookupKey(key)
	if !ok || !rec.underBudget() {
		return r, false
	}
	up := r.Clone(r.Context())
	up.URL.Scheme, up.URL.Host = os.Getenv("UPSTREAM_SCHEME"), os.Getenv("UPSTREAM_HOST")
	// Strip every client-supplied routing header before re-adding our own.
	for _, h := range []string{"Authorization", "X-Api-Key", "X-Forwarded-For",
		"X-Real-Ip", "X-Forwarded-Host", "X-Forwarded-Proto", "Base-Url", "Api-Base"} {
		up.Header.Del(h)
	}
	up.Header.Set("Authorization", "Bearer "+rec.UpstreamKey)
	up.Header.Set("X-Forwarded-For", r.RemoteAddr) // connection peer, not a header
	return up, true
}

// tee copies the response to the client AND accumulates the tail so we can
// scrape usage. Never buffer the whole body.
func tee(w http.ResponseWriter, body *bufio.Reader, fn func(usage)) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 1<<20), 8<<20)
	var last usage
	for sc.Scan() {
		w.Write(sc.Bytes())
		w.(http.Flusher).Flush() // F-12 — without this, SSE dies
		var e struct {
			Type  string `json:"type"`
			Usage usage  `json:"usage"`
			Message struct {
				Usage usage `json:"usage"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &e) == nil {
			if e.Usage != (usage{}) {
				last = e.Usage
			} else if e.Message.Usage != (usage{}) {
				last = e.Message.Usage
			}
		}
	}
	fn(last)
}

func main() {
	client := &http.Client{Timeout: 900 * time.Second}
	http.HandleFunc("/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		up, ok := auth(r)
		if !ok {
			http.Error(w, `{"error":{"type":"auth_error"}}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)

		ctx, cancel := context.WithTimeout(r.Context(), 900*time.Second)
		defer cancel()
		resp, err := client.Do(up.WithContext(ctx))
		if err != nil {
			log.Printf("upstream: %v", err)
			return
		}
		defer resp.Body.Close()
		tee(w, bufio.NewReader(resp.Body), func(u usage) {
			record(keyOf(r), route("/v1/messages"), u, time.Since(start))
		})
	})
	log.Fatal(http.ListenAndServe("127.0.0.1:4000", nil))
}
```

### 12.3 What you now owe yourself

Reimplementing the proxy means owning, from scratch and correctly:

- [ ] Key issuance, storage (hashed), rotation, revocation
- [ ] Token-bucket rate limiting (concurrency-safe)
- [ ] Spend ceilings with correct reset windows
- [ ] A write path that cannot lose a request under crash
- [ ] TLS, WAF, abuse controls
- [ ] Reporting and reconciliation
- [ ] Every §11 threat control
- [ ] Updates when the upstream changes a response shape

The maintenance burden is the whole cost. It is roughly the same as the features
LiteLLM gives you for free.

### 12.4 Schema, if you go custom

```sql
CREATE TABLE usage_events (
  id                     BIGSERIAL PRIMARY KEY,
  ts                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  api_key_id             TEXT        NOT NULL,   -- authoritative identity
  client_ip              INET,                   -- abuse signal only
  route                  TEXT        NOT NULL,   -- '/v1/messages' template
  model                  TEXT        NOT NULL,
  input_tokens           INTEGER     NOT NULL DEFAULT 0,
  output_tokens          INTEGER     NOT NULL DEFAULT 0,
  cache_write_5m_tokens  INTEGER     NOT NULL DEFAULT 0,
  cache_write_1h_tokens  INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER     NOT NULL DEFAULT 0,
  latency_ms             INTEGER,
  status                 INTEGER,
  cost_usd               NUMERIC(12,6) NOT NULL DEFAULT 0,
  price_table_version    TEXT                     -- so old rows stay auditable
);

CREATE INDEX ON usage_events (api_key_id, ts DESC);
CREATE INDEX ON usage_events (route, ts DESC);
CREATE INDEX ON usage_events (client_ip, ts DESC);
```

Two rules:

1. **Store the route template, not the raw path.** Path parameters create
   unbounded row cardinality.
2. **Store `price_table_version`.** When you change prices, historical rows must
   still be explainable at the rates that applied when they were served.

Useful queries:

```sql
-- Per-key daily spend
SELECT date_trunc('day', ts) AS d, api_key_id,
       COUNT(*)                                   AS requests,
       SUM(input_tokens + output_tokens)          AS total_tokens,
       SUM(cost_usd)                              AS usd
FROM usage_events
GROUP BY 1, 2 ORDER BY 1 DESC, 4 DESC;

-- Token class mix — catches cache accounting regressions
SELECT model,
       SUM(cache_read_tokens)     AS cached,
       SUM(cache_write_1h_tokens) AS w1h,
       SUM(cache_write_5m_tokens) AS w5m,
       SUM(output_tokens)         AS out
FROM usage_events
WHERE ts > now() - interval '7 days'
GROUP BY 1;

-- Top offending sources (abuse hunting, NOT billing)
SELECT client_ip, COUNT(*) AS reqs, SUM(cost_usd) AS usd
FROM usage_events
WHERE ts > now() - interval '1 hour'
GROUP BY 1 HAVING COUNT(*) > 1000 ORDER BY reqs DESC;
```

---

## 13. Deployment runbook

### 13.1 Prerequisites

- [ ] VPS: 1 vCPU / 1–2 GB RAM / 25 GB disk (Ubuntu 24.04 LTS or Debian 12)
- [ ] Domain with DNS control
- [ ] Console API key from the upstream provider (**not** a subscription key)
- [ ] A non-root user for running containers

### 13.2 DNS

```bash
# A records → VPS IP. Proxy off (DNS-only) unless you completed §11.2 step 2.
api     A     <VPS_IP>
admin   A     <VPS_IP>
```

DNS propagation is not instant. Verify before proceeding:

```bash
dig +short api.yourdomain.com
```

### 13.3 Base host

```bash
ssh root@<VPS_IP>
adduser --disabled-password --gecos "" gateway
usermod -aG sudo gateway
rsync --archive --chown=gateway:gateway ~/.ssh/authorized_keys /home/gateway/.ssh/
```

### 13.4 Firewall and SSH hardening

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Then, before closing this session:

```bash
# Restrict SSH to your IP — replace with your actual address
ufw allow from <YOUR_IP> to any port 22 proto tcp
ufw delete allow 22/tcp
```

Verify you can still log in **in a second terminal** before closing the first.

### 13.5 Deploy

```bash
cd /opt/gateway

# Secrets
openssl rand -hex 32   # LITELLM_MASTER_KEY
openssl rand -hex 32   # LITELLM_SALT_KEY
cat > .env <<'EOF'
API_DOMAIN=api.yourdomain.com
ADMIN_DOMAIN=admin.yourdomain.com
LITELLM_MASTER_KEY=sk-...
LITELLM_SALT_KEY=sk-...
UPSTREAM_BASE_URL=https://api.anthropic.com
UPSTREAM_API_KEY=sk-ant-...
EOF
chmod 600 .env

# Bring up
docker compose up -d
docker compose logs -f litellm     # wait for healthy

# Confirm Postgres is wired — budgets silently no-op without it
docker compose exec litellm \
  python -c "import os; print(os.environ['DATABASE_URL'][:30])"
```

Verify in the Admin UI (`https://admin.yourdomain.com/ui`): **Models** → spend
values must be **non-zero**. If they are zero, your price table isn't matching
the model name and every budget will be wrong.

### 13.6 Ongoing operations

| Cadence | Task |
|---|---|
| Daily | `pg_dump` → off-site encrypted backup |
| Daily | Alert on spend > threshold |
| Weekly | Rotate one tenant key (tests revocation) |
| Monthly | Reconcile vs upstream Usage API (§10.7) |
| Monthly | Review `prices/models.yaml` against live pricing |
| Monthly | Update `trusted_proxies` CIDRs if using Cloudflare |
| On model deprecation | Map alias to replacement; notify tenants |

```bash
#!/usr/bin/env bash
# scripts/backup.sh — cron: 17 3 * * *
set -euo pipefail
cd /opt/gateway
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres \
  pg_dump -U litellm litellm | gzip > "backup-${STAMP}.sql.gz"
aws s3 cp "backup-${STAMP}.sql.gz" "s3://your-backups/gateway/" \
  --sse AES256 --storage-class STANDARD_IA
find . -name 'backup-*.sql.gz' -mtime +7 -delete
```

> Back up `.env`'s `LITELLM_SALT_KEY` **separately and securely**. It is not in
> the `pg_dump`, and losing it bricks every stored provider credential (§11.4).

---

## 14. Verification and acceptance tests

Run all of these after first deploy and after every significant change.

### 14.1 Connectivity and auth

```bash
# 1. Upstream reachable directly
curl -s https://<UPSTREAM_BASE_URL>/v1/models \
  -H "x-api-key: $UPSTREAM_API_KEY" | head -c 200

# 2. Gateway rejects a bad key
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer sk-invalid" \
  -H 'Content-Type: application/json' -d '{"model":"fast","messages":[]}'
# expect 401

# 3. Gateway accepts a valid key
curl -s https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer $TENANT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"fast","messages":[{"role":"user","content":"say hi"}]}'
# expect a completion
```

### 14.2 Model allowlist

```bash
# Key is scoped to `fast` only
curl -s https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer $CHEAP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"smart","messages":[{"role":"user","content":"hi"}]}'
# expect a permission error, NOT a completion
```

### 14.3 Budget enforcement — **the test people skip**

```bash
curl -s -X POST http://127.0.0.1:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"key_name":"canary","models":["fast"],
       "max_budget":0.000001,"budget_duration":"30d"}'

# Now call it. MUST be rejected.
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer <canary-key>" \
  -H 'Content-Type: application/json' \
  -d '{"model":"fast","messages":[{"role":"user","content":"hi"}]}'
# expect 429 (per budget_exceeded_status_code)
```

**If this returns 200, your Postgres connection is broken and no budget in the
system is being enforced.** Stop and fix it before issuing any real keys.

### 14.4 Streaming

```bash
time curl -sN https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer $TENANT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"fast","stream":true,
       "messages":[{"role":"user","content":"count 1 to 20 slowly"}]}'
```

Chunks must arrive **incrementally**, not as one blob at the end. If it all
arrives at once, buffering is back — check `flush_interval -1`.

Automated check:

```bash
python3 - <<'PY'
import time, json, urllib.request, os
req = urllib.request.Request(
    "https://api.yourdomain.com/v1/chat/completions",
    data=json.dumps({"model":"fast","stream":True,
        "messages":[{"role":"user","content":"count slowly to 20"}]}).encode(),
    headers={"Authorization": f"Bearer {os.environ['TENANT_KEY']}",
             "Content-Type":"application/json"})
t0, first, n = time.time(), None, 0
with urllib.request.urlopen(req, timeout=120) as r:
    for line in r:
        if line.startswith(b"data:"):
            if first is None: first = time.time() - t0
            n += 1
assert first is not None and first < 10, f"TTFT {first:.1f}s — likely buffered"
print(f"PASS  TTFT={first:.2f}s  chunks={n}")
PY
```

### 14.5 Token accounting

After a request that uses a large cached prefix, verify the Admin UI shows
non-zero **cache read** tokens, and that spend is far below the
uncached-equivalent. Then confirm a request with **no** cache control shows
zero cache tokens.

### 14.6 IP spoofing — **verify this explicitly**

```bash
# Direct-to-origin call with a forged XFF
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/v1/chat/completions \
  -H "X-Forwarded-For: 203.0.113.99" \
  -H "CF-Connecting-IP: 203.0.113.99" \
  -H "Authorization: Bearer $TENANT_KEY" \
  -H 'Content-Type: application/json' -d '{"model":"fast","messages":[]}'

# Then check what IP was actually recorded
curl -s "http://127.0.0.1:4000/key/info" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" | jq '.spend, .spend_logs[0].api_key'
```

If the recorded client IP is `203.0.113.99`, **§11.2 is not fixed** and all IP
limits are void.

### 14.7 SSRF

```bash
curl -s https://api.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer $TENANT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"fast","api_base":"http://169.254.169.254/","messages":[]}'
# must NOT attempt to reach the metadata endpoint
```

### 14.8 Cost reconciliation

Take 100 real requests, compute §8.5 by hand, compare against LiteLLM's
reported spend. Investigate any per-model delta > 2%.

### 14.9 Acceptance checklist

| # | Test | Pass |
|---|---|---|
| 1 | Bad key → 401 | ☐ |
| 2 | Valid key → completion | ☐ |
| 3 | Disallowed model → denied | ☐ |
| 4 | Over-budget → 429 (**hard stop**) | ☐ |
| 5 | Streaming is incremental, TTFT < 10s | ☐ |
| 6 | Cache read tokens recorded | ☐ |
| 7 | Cache TTL split reflected in cost | ☐ |
| 8 | Forged XFF ignored | ☐ |
| 9 | Forged `api_base` ignored | ☐ |
| 10 | Admin UI unreachable from non-allowlisted IP | ☐ |
| 11 | `/key/*` not served on public hostname | ☐ |
| 12 | Spend reconciles vs upstream within 2% | ☐ |
| 13 | Key revocation takes effect immediately | ☐ |
| 14 | Restore from backup reproduces state | ☐ |

---

## 15. Operating costs

| Item | Small | Medium | Notes |
|---|---|---|---|
| VPS 1 vCPU / 1 GB | ~$5/mo | — | Comfortable for <20 concurrent streams |
| VPS 2 vCPU / 4 GB | — | ~$12/mo | Use above ~50 concurrent streams |
| Managed Postgres | $0 | $19/mo | Single-node container is fine to ~10k req/day |
| Managed Redis | $0 | $15/mo | Only needed for multi-replica |
| Caddy / certificates | $0 | $0 | Let's Encrypt |
| **Infrastructure total** | **~$5/mo** | **~$46/mo** | |

Upstream token cost dominates everything here and is independent of this
architecture.

**Scaling trigger:** LiteLLM is Python. Its GIL becomes the bottleneck at high
concurrency. If p99 latency climbs while CPU is pegged on a single core, move to
Bifrost (Go) or run multiple LiteLLM replicas behind the same Caddy with Redis
coordinating rate limits.

---

## 16. Open decisions

Resolve before implementation begins.

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | Is the upstream an authorised reseller? | §2.3, third-party use | **Assume no → private use only** |
| 2 | OpenAI-compatible or Anthropic-native upstream? | Config shape | Support **both**; LiteLLM handles `/v1/messages` and `/v1/chat/completions` |
| 3 | Is the base URL yours to brand publicly? | Branding | Don't brand until (1) is answered |
| 4 | Cloudflare or direct to origin? | §11.2 posture | **Direct.** Strictly simpler and safer |
| 5 | One key per user, or one key with per-`user` attribution? | Key issuance design | One key per user — immune to body-`user` evasion |
| 6 | Whose name appears in Admin UI metrics — key owner or `user_id`? | Reporting | Always set `user_id` at key creation |
| 7 | Store prompt content for debugging? | Privacy posture | **No.** Counts only |
| 8 | Budget reset window per tenant? | Key config | `30d`, aligned to invoicing |
| 9 | Long-context tier pricing in scope? | Price table | Yes — it silently breaks cost accuracy |
| 10 | Invoicing, or cost visibility only? | Scope | Visibility only in v1 |
| 11 | Which tenant is the billing identity in shared backend services? | §10.3 | One key per logical tenant, always |

---

## 17. Sources

**Terms and policy**
- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) — §A.1 permitted use, §D.2 resale restriction
- [Anthropic Consumer Terms of Service](https://claude.ai/legal) — credential sharing prohibition
- [Anthropic Usage and Cost API](https://docs.anthropic.com/en/api/data-usage-cost-api) — independent verification source
- [Anthropic Token counting](https://docs.anthropic.com/es/docs/build-with-claude/token-counting) — free pre-flight counting

**Pricing and caching**
- [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 1.25×/2.0×/0.1× multipliers, TTL behaviour, per-model exceptions
- [ccusage issue #899](https://github.com/ccusage/ccusage/issues/899) — 19% under-reporting from merged cache-TTL rates; the concrete basis for §8.3
- [pydantic-ai caching docs](https://github.com/pydantic/pydantic-ai/blob/main/docs/capabilities/caching.md) — break-even analysis per provider

**Gateway**
- [LiteLLM docs](https://docs.litellm.ai/) — proxy architecture, config reference
- [LiteLLM production best practices](https://docs.litellm.ai/docs/proxy/prod) — salt key, Redis, connection exhaustion
- [LiteLLM spend tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) — `/spend/*` access control, user_id evasion warning
- [LiteLLM endpoint activity](https://docs.litellm.ai/docs/proxy/endpoint_activity) — per-endpoint attribution
- [LiteLLM cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) — customer usage tracking
- [LLM Gateway comparison](https://llmgateway.io/blog/portkey-alternatives) — 2026 landscape, acquisition status
- [Comparing open source LLM gateways](https://netfoundry.io/ai/comparing-open-source-llm-gateways) — tradeoffs

**Edge and security**
- [Caddy `reverse_proxy` reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — `flush_interval`, `trusted_proxies`, streaming semantics
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) — `CF-Connecting-IP` semantics
- [Cloudflare: restoring visitor IPs](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/) — correct Caddy+Cloudflare config
- [Caddy issue #5804](https://github.com/caddyserver/caddy/issues/5804) — why left-most XFF is the least trustworthy
- [CVE-2023-50463](https://nvd.nist.gov/vuln/detail/CVE-2023-50463) — caddy-geo-ip XFF spoofing bypass
- [CVE-2024-21494](https://nvd.nist.gov/vuln/detail/CVE-2024-21494) — caddy-security auth bypass via XFF
- [GHSA-73p3-rqpv-59wx](https://github.com/hestiacp/hestiacp/security/advisories/GHSA-73p3-rqpv-59wx) — unvalidated `CF-Connecting-IP` (2026)

**Interop**
- [Anthropic OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk) — official OpenAI-format layer

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Virtual key** | The API key *you* issue. LiteLLM's term for a tenant credential |
| **Master key** | Your gateway's root credential. Management API + Admin UI |
| **Budget window** | The period over which `max_budget` resets |
| **Cache write** | Tokens written to Anthropic's prompt cache. Charged at 1.25× or 2× |
| **Cache read** | Tokens served from cache. Charged at 0.1× |
| **TTFT** | Time to first token. The streaming-health metric |
| **SSE** | Server-Sent Events. The transport for streaming LLM responses |
| **XFF** | `X-Forwarded-For`. Client IP propagation header, and a spoofing vector |
| **SSRF** | Server-Side Request Forgery. Using your server to reach internal targets |
| **model_group** | LiteLLM's term for a `model_name` and its backing deployments |

## Appendix B — Glossary of anti-patterns

| Anti-pattern | Why it's wrong |
|---|---|
| `trusted_proxies 0.0.0.0/0` | Disables XFF spoofing protection entirely |
| Billing by IP | NAT means one IP ≠ one user |
| Trusting body-supplied `user` for billing | Documented evasion vector in LiteLLM |
| Pricing all cache creation at 1.25× | Under-bills 1h-TTL workloads by ~19% |
| Buffering responses | Breaks streaming; TTFT explodes |
| Accepting `api_base` from clients | SSRF into your VPC and cloud metadata |
| Publishing LiteLLM on `0.0.0.0:4000` | Bypasses TLS, rate limits, and IP controls |
| Serving Admin UI on the public API host | One leaked master key → total compromise |
| Storing `LITELLM_SALT_KEY` only in the DB backup | Losing it bricks all stored credentials |
| No spend ceiling, only RPM/TPM | Slow-burn drain is never rate-limited |