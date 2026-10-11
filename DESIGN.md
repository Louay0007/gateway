# System Design — LLM Gateway (final)

**Status:** Locked. Decisions below are final unless §11 changes them.
**Date:** 2026-10-11
**Companion:** `BLUEPRINT.md` — reasoning, legal analysis, threat model, runbook.
**Supersedes:** the tech choices in `BLUEPRINT.md` §4 where they conflict.

---

## 1. Requirement this design satisfies

> Upstream provider is **both OpenAI-compatible and Anthropic-compatible**.
> The gateway must accept **both wire formats** and **both auth header styles**,
> forward **without translation loss**, and enforce per-key token/cost limits
> with attribution by endpoint and IP.

---

## 2. Locked technology stack

| Layer | Choice | Pin | Rationale |
|---|---|---|---|
| OS | Ubuntu 24.04 LTS | — | Long support window, `ufw`, unattended-upgrades |
| Orchestration | Docker Compose | v2 | Single VPS. K8s is unjustified at this scale |
| Edge / TLS | Caddy | `2-alpine` | Native ACME, `flush_interval -1`, one-file config |
| CDN | **None** | — | Removes the entire XFF-spoofing class. See §6.1 |
| **Gateway** | **LiteLLM Proxy** | `v1.103.1` | Only OSS option with budgets + TPM + allowlists + spend logs in the free core |
| Gateway core | LiteLLM **Rust** | bundled | 0.66 ms p99 overhead, ~22 MB RSS. The old "Python is the bottleneck" objection no longer applies |
| Database | PostgreSQL | `16-alpine` | **Required.** Budgets silently no-op without it |
| Cache / limiter | Redis | `7-alpine` | Key cache + cross-replica rate counters |
| Metrics | Prometheus | built-in | `success_callback: ["prometheus"]` |
| Secrets | `.env` at `0600` | — | Docker secrets as the hardening step |
| Backups | `pg_dump` + encrypted offsite | — | Salt key backed up **separately** |

**Version pin rationale.** LiteLLM v1.84.0+ follows PEP 440; `litellm:1.103.1`
and `litellm:v1.103.1` resolve to the same image. `v1.103.1` was the current
stable at time of writing (`v1.104.0-rc.2` is pre-release — **do not pin an
rc**). All images are cosign-signed; verify with the published key.

**Two features that force a minimum version:**

| Feature | Requires | Why |
|---|---|---|
| `supported_endpoints` opt-in | **≥ v1.92.0** | Untranslated `/v1/messages` for OpenAI-compatible deployments. This is the whole dual-format design |
| Redis transaction buffer | ≥ v1.90 | Prevents Postgres connection exhaustion at high RPS |

**Bifrost is no longer the recommended upgrade path.** LiteLLM's Rust rewrite put
it at 0.66 ms p99 vs Bifrost's 4.54 ms, with lower memory. Revisit only if you
need a specific Bifrost-only feature.

---

## 3. Final repository structure

```
gateway/
├── DESIGN.md                    ← this file (decisions, locked)
├── BLUEPRINT.md                 ← analysis, legal, threats, runbook, tests
├── README.md                    ← quickstart for whoever runs this
│
├── docker-compose.yml
├── .env                         ← secrets, 0600, gitignored
├── .env.example
├── Makefile                     ← single-entry-point operations
│
├── config/
│   ├── litellm.yaml             ← dual-format model_list + governance
│   └── Caddyfile                ← edge, streaming, admin gating
│
├── prices/
│   └── models.yaml              ← versioned price table
│
├── scripts/
│   ├── probe-upstream.sh        ← DETECTS which formats upstream supports
│   ├── issue-key.sh             ← mint scoped tenant key
│   ├── report.sh                ← per-tenant usage reports
│   ├── reconcile.sh             ← gateway ledger vs upstream Usage API
│   ├── backup.sh                ← nightly pg_dump
│   └── smoke.sh                 ← acceptance suite (§9)
│
└── docs/
    ├── RUNBOOK.md
    ├── INCIDENT-UPSTREAM-KEY-LEAK.md
    └── ADD-UPSTREAM.md
```

---

## 4. Dual-format design — the core of the system

### 4.1 What the gateway exposes

| Client format | Endpoint | Auth accepted |
|---|---|---|
| **OpenAI** | `POST /v1/chat/completions` | `Authorization: Bearer sk-…` |
| **OpenAI** | `POST /v1/responses` | `Authorization: Bearer sk-…` |
| **OpenAI** | `GET /v1/models` | `Authorization: Bearer sk-…` |
| **Anthropic** | `POST /v1/messages` | `Authorization: Bearer` **or** `x-api-key` |
| **Anthropic** | `POST /v1/messages/count_tokens` | same |
| Ops | `GET /health` | none |

Both auth headers are accepted everywhere. LiteLLM reads `Authorization` and
`x-api-key` interchangeably on its routes, which is what makes Claude Code,
the Anthropic SDK, and the OpenAI SDK all work against one base URL with one key.

### 4.2 Why "both formats" is not automatic

This is the part most gateway builds get wrong. When a client hits
`/v1/messages` against an OpenAI-compatible deployment, **LiteLLM translates**
the request. Its own documentation states this loses data:

> "cache_control blocks are dropped, thinking is mapped to the provider's own
> reasoning parameter, and other Anthropic-only request details are
> approximated or lost."

Prompt caching is the expensive loss. A cache-read token costs **0.1×** base
input; a cache-write costs 1.25×–2×. Dropping `cache_control` doesn't just
degrade performance, it **inflates your bill ~10× on repeated prefixes** —
silently, because nothing errors.

### 4.3 The `supported_endpoints` opt-in (v1.92.0+)

Opting a deployment into native `/v1/messages` forwarding:

```yaml
- model_name: fast
  litellm_params:
    model: openai/claude-sonnet-5
    api_base: os.environ/UPSTREAM_BASE_URL
    api_key: os.environ/UPSTREAM_API_KEY
    cache_control_ttl: true          # forward cache_control TTL unchanged
  model_info:
    supported_endpoints:
      - "/v1/chat/completions"
      - "/v1/messages"               # ← the opt-in
```

Resulting behaviour, per the docs:

- `/v1/messages` is POSTed to `{api_base}/v1/messages` with the Anthropic body
  **unchanged** (except `cache_control` handling).
- A trailing `/v1` on `api_base` is stripped, so `https://x/v1` and `https://x`
  both resolve to `https://x/v1/messages`.
- LiteLLM sends `Authorization: Bearer <api_key>` **unless** the incoming
  request already carries `Authorization` or `x-api-key` — meaning the upstream's
  preferred auth style is preserved.
- `anthropic-version` defaults to `2023-06-01`; `anthropic-beta` headers are
  forwarded, both caller-sent and LiteLLM-added.
- **Without** the opt-in, translation happens as described in §4.2.

### 4.4 Deployment-pairing strategy

A single `model_name` maps to a **model group** with multiple deployments. We
register the same upstream twice so LiteLLM can route by endpoint:

```yaml
- model_name: fast
  litellm_params:
    model: anthropic/claude-sonnet-5     # natively supports /v1/messages
    api_base: os.environ/UPSTREAM_BASE_URL
    api_key: os.environ/UPSTREAM_API_KEY

- model_name: fast
  litellm_params:
    model: openai/claude-sonnet-5       # /chat/completions native
    api_base: os.environ/UPSTREAM_BASE_URL
    api_key: os.environ/UPSTREAM_API_KEY
  model_info:
    supported_endpoints: ["/v1/chat/completions", "/v1/messages"]
```

**Verify this pairing behaves as documented in your version** (acceptance test
A-4). If endpoint filtering does not select the right deployment, fall back to
distinct aliases — `fast` (OpenAI path) and `fast-anthropic` (native path) —
and publish both. Correctness over convenience; document the mapping for users.

### 4.5 The URL-suffix trap

When `api_base` is not `api.anthropic.com`, LiteLLM **auto-appends** a path:

| `api_base` | LiteLLM calls |
|---|---|
| `https://my-proxy.com` | `https://my-proxy.com/v1/messages` |
| `https://my-proxy.com/api` | `https://my-proxy.com/api/v1/messages` |

If your provider's base URL already ends in the full path, this double-appends.
Fix:

```bash
LITELLM_ANTHROPIC_DISABLE_URL_SUFFIX=true
```

Set it whenever `api_base` is non-standard. `scripts/probe-upstream.sh` prints
the exact URL LiteLLM will construct.

### 4.6 Provider-format decision tree

Run the probe first. It emits one of three verdicts.

```
                     ┌─────────────────────────┐
                     │  probe-upstream.sh      │
                     └────────────┬────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
        BOTH available      OpenAI only         Anthropic only
              │                   │                   │
     §4.3 pairing          openai/ only,      anthropic/ only
     lossless both         /v1/messages       /v1/chat/completions
     paths                TRANSLATED ⚠️        TRANSLATED ⚠️
              │                   │                   │
        ✅ SHIP             ⚠️ cache_control    ⚠️ system msgs +
                           lost, ~10× cost     tool-call shapes
                           on cached prefixes   approximated
```

**If the probe returns "OpenAI only", stop and reassess.** Prompt caching is
central to Claude cost economics, and translation silently destroys it. Options:
(a) ask the provider for their Anthropic endpoint, (b) accept the cost and warn
users, (c) use the Anthropic SDK path exclusively.

### 4.7 Client configuration

```bash
# Claude Code
export ANTHROPIC_BASE_URL=https://api.yourdomain.com
export ANTHROPIC_AUTH_TOKEN=sk-your-issued-key
export ANTHROPIC_API_KEY=""          # MUST be empty — see below
export ANTHROPIC_MODEL=fast
export ANTHROPIC_SMALL_FAST_MODEL=fast
```

> `ANTHROPIC_API_KEY=""` is not optional. Claude Code checks `ANTHROPIC_API_KEY`
> **first**; if it is non-empty it wins over `ANTHROPIC_AUTH_TOKEN`, and it is
> sent as `X-Api-Key` while `ANTHROPIC_AUTH_TOKEN` is sent as
> `Authorization: Bearer`. Set it empty and use `ANTHROPIC_AUTH_TOKEN`.

```python
# OpenAI SDK
from openai import OpenAI
client = OpenAI(api_key="sk-…", base_url="https://api.yourdomain.com/v1")

# Anthropic SDK
from anthropic import Anthropic
client = Anthropic(base_url="https://api.yourdomain.com", api_key="sk-…")
```

---

## 5. Identity and auth design

### 5.1 One key per logical tenant — no exceptions

Each tenant gets **one issued key** carrying a pinned `user_id`.

Rationale, from LiteLLM's own documentation: if you hand keys to end users they
can move their spend to an arbitrary `end_user_id` with a one-line body change
(`"user": "someone-else"`). Pinned `user_id` + one key per tenant removes the
evasion vector entirely.

```
tenant ──1──1── virtual key ──1──1── user_id (pinned)
                 │
                 ├── models[]         allowlist
                 ├── max_budget       spend ceiling, hard stop
                 ├── budget_duration  reset window
                 ├── rpm_limit        flood control
                 ├── tpm_limit        wallet protection
                 └── max_parallel_requests
```

### 5.2 Auth header matrix

| Client | Sends | Gateway accepts | Upstream receives |
|---|---|---|---|
| OpenAI SDK | `Authorization: Bearer` | ✅ | provider-native style |
| Anthropic SDK | `x-api-key` | ✅ | provider-native style |
| Claude Code | `Authorization: Bearer` (`ANTHROPIC_AUTH_TOKEN`) | ✅ | provider-native |
| curl | either | ✅ | provider-native |

### 5.3 IP: signal, never identity

Full reasoning in `BLUEPRINT.md` §10.2. Summary of the enforced rule:

- **IP →** flood control, geo-anomaly detection, abuse counters
- **Never IP →** quotas, budgets, billing, access decisions

### 5.4 Endpoint attribution

Tracked automatically per endpoint. **Do not expect gateway counts and
spend-log-derived counts to tie out** — different sources, different questions.
Reconcile deliberately; document the expected delta rather than chasing it.

---

## 6. Security posture

### 6.1 No CDN (final decision)

The default is **DNS-only, A record → VPS**, no Cloudflare.

Rationale: every CDN adds an IP-header trust boundary that has been exploited
repeatedly in this exact stack — CVE-2023-50463 (caddy-geo-ip), CVE-2024-21494
(caddy-security auth bypass), GHSA-73p3-rqpv-59wx (HestiaCP, Jul 2026,
unvalidated `CF-Connecting-IP` bypassing fail2ban and IP allowlists).

For a handful of tenants, a CDN buys nothing that matters. Removing the
boundary removes the vulnerability class.

**If a CDN becomes mandatory**, all three controls together or none:
1. Caddy `trusted_proxies` set to the Cloudflare CIDR list
2. Origin firewall allowing `:443` **only** from those CIDRs
3. Scheduled refresh of the CIDR list

`trusted_proxies 0.0.0.0/0` on an internet-reachable origin is never acceptable.

### 6.2 Non-negotiable controls

| # | Control | Enforced by |
|---|---|---|
| 1 | Upstream URL never client-controllable | `api_base: os.environ/…` only |
| 2 | Upstream credential never in responses/logs | env vars, not config literals |
| 3 | Gateway port bound to loopback | `127.0.0.1:4000:4000` |
| 4 | Admin surface on a separate, IP-gated host | Caddy `admin.` block, default-deny |
| 5 | Management routes not public | `allowed_routes` |
| 6 | Prompt content not persisted | `store_prompts_in_spend_logs: false` |
| 7 | Hard spend ceiling, not just rate limits | `max_budget` + `budget_exceeded_status_code: 429` |
| 8 | Body-supplied `user` cannot redirect spend | pinned `user_id` |
| 9 | Ledger bounded | `maximum_spend_logs_retention_period` |
| 10 | Salt key backed up separately | Ops checklist |

### 6.3 Prompt content should not transit your server

Architecturally the gateway sees prompts. It does not have to keep them. Keeping
`store_prompts_in_spend_logs: false` is the difference between "we proxy API
calls" and "we are a data processor for our users' content."

---

## 7. Cost accounting

Full detail in `BLUEPRINT.md` §8. Locked rules:

| Rule | Rationale |
|---|---|
| Track 4 token classes: input, output, cache-write, cache-read | Counting only `input_tokens` over-reports cached traffic ~10× |
| Split cache writes by TTL (`ephemeral_5m` / `ephemeral_1h`) | Merged field at 1.25× under-bills 1h-TTL workloads by ~19% |
| Prices in version control, reviewed monthly | `prices/models.yaml`, never hardcoded in logic |
| Reconcile LiteLLM's spend against your own computation | LiteLLM may apply one rate to all cache creation |
| Reconcile against the upstream Usage API monthly | Independent source of truth |

Multipliers: write-5m **1.25×**, write-1h **2.0×**, cache-read **0.1×** — with
per-model exceptions. Verify against the live pricing page monthly.

---

## 8. Data flow

```
Client ──(Bearer | x-api-key)──► Caddy ──► LiteLLM :4000
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │ 1. authenticate key     │ 5. inject upstream cred │
              │ 2. authorize allowlist  │ 6. forward (SSE tee)    │
              │ 3. rpm/tpm/concurrency │ 7. scrape usage         │
              │ 4. budget ceiling      │ 8. write spend log      │
              └─────────────────────────┼─────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
              Upstream provider                    PostgreSQL + Redis
        (dual-format, env-configured URL)        (keys, budgets, logs)
```

---

## 9. Acceptance tests

Run `scripts/smoke.sh` after every deploy and every upstream change.

| ID | Test | Pass condition |
|---|---|---|
| A-1 | Bad key, both auth headers | 401 on `/v1/chat/completions` **and** `/v1/messages` |
| A-2 | Valid key, OpenAI path | 200 + completion |
| A-3 | Valid key, Anthropic path | 200 + completion |
| **A-4** | **Dual-format pairing** | Same `model_name` resolves correctly on **both** endpoints; no translation artifacts |
| **A-5** | **Auth header matrix** | `Authorization: Bearer` **and** `x-api-key` both work on `/v1/messages` |
| **A-6** | **`cache_control` survives** | Cached-prefix request shows non-zero `cache_read_input_tokens` **on the Anthropic path** |
| A-7 | Model allowlist | Disallowed model → denied, not served |
| **A-8** | **Budget hard stop** | `max_budget: 0.000001` → 429. **If this returns 200, Postgres is broken and no budget is enforced** |
| A-9 | Streaming | TTFT < 10s, chunks arrive incrementally |
| A-10 | Cost accuracy | 100 real requests: own §8 computation vs LiteLLM, <2% delta |
| A-11 | Forged `X-Forwarded-For` | Recorded IP is the real connection peer |
| A-12 | Forged `api_base` in body | Ignored; no request to the injected host |
| A-13 | Admin isolation | Admin host 403 from a non-allowlisted IP |
| A-14 | Management routes | `/key/generate` not served on the public API host |
| A-15 | Spend evasion | Body `"user":"other"` does **not** move spend off the key's tenant |
| A-16 | Revocation | Disabled key → 401 immediately |
| A-17 | Restore | Backup restore reproduces keys, budgets, and spend history |

A-4, A-5, A-6, A-8, A-15 are the ones that catch real failures. The rest are
hygiene.

---

## 10. Implementation order

| Phase | Work | Gate |
|---|---|---|
| 0 | Provision VPS, DNS, firewall, user | Port 443 reachable, only your IP on SSH |
| 1 | `probe-upstream.sh` → know the real format matrix | Verdict recorded. **If "OpenAI only", stop and reassess (§4.6)** |
| 2 | Deploy Postgres + Redis + LiteLLM | Admin UI shows non-zero model spend |
| 3 | Write `config/litellm.yaml` for the detected matrix | Model list loads without error |
| 4 | Deploy Caddy; issue first test key | A-1, A-2, A-3 pass |
| 5 | Verify dual-format | **A-4, A-5, A-6 pass** |
| 6 | Verify governance | **A-8, A-15 pass** |
| 7 | Reporting, reconciliation, backups | A-10, A-17 pass |
| 8 | Onboard tenants | Per-tenant smoke test |

Phase 5 is the go/no-go gate for dual-format. Do not onboard anyone before it.

---

## 11. Decisions locked, with reversal triggers

| Decision | Locked as | Reverse when |
|---|---|---|
| LiteLLM as gateway | v1.103.1 | A governance feature you need is Enterprise-only and the license cost exceeds build cost |
| No CDN | Direct A record | You genuinely need edge latency, and implement **all three** §6.1 controls |
| One key per tenant | Pinned `user_id` | Never — the evasion vector is structural |
| Dual-format lossless pairing | `supported_endpoints` opt-in | The upstream only offers OpenAI (then reassess entirely, §4.6) |
| No prompt persistence | `store_prompts_in_spend_logs: false` | A legal/compliance need for content logs, with retention defined |
| Postgres on same VPS | Single node | Sustained >1000 rps or need for point-in-time recovery → managed |
| Bifrost as upgrade path | Not recommended | LiteLLM Rust core regresses on your workload profile |
| Pricing in YAML | `prices/models.yaml` | Never — it must stay reviewable and versioned |
| Caddy first-byte ceiling | `response_header_timeout: 300s` | Lower only if you forbid max-effort reasoning (TTFA to 150s) |
| LiteLLM log level | `LITELLM_LOG=ERROR` | Raise to INFO during an incident, then put back |
| Routing strategy | `usage-based-routing-v2` | Never `latency-based-routing` — it routes `/v1/messages` to the translating deployment |
| Retry policy | `num_retries: 2`, `retry_after: 1`, cooldown 3/min→60s | Tighten only with per-error data from your own logs |
| Deployment timeouts | `fast: 240s`, `smart: 600s` | Lower `fast` only if you cap its max_tokens |
| Uvicorn workers | `${NUM_WORKERS:-2}` | Scale with vCPUs; watch `in_flight_requests` + PG connections |
| Caddy keep-alive pool | 64 idle conns/host to LiteLLM | Raise if `up_lat_ms` climbs under concurrency |

---

## 12. Open items for the operator

These are **not** design gaps — they are facts only you can supply.

1. **Is the upstream an authorised reseller?** If no → private/team use only. See
   `BLUEPRINT.md` §2.3. This gates third-party onboarding.
2. **Which format did the probe report?** Drives which `model_list` block.
3. **Are these keys Console API keys**, not claude.ai subscription credentials?
4. **Do you use prompt caching?** If yes and the probe said "OpenAI only",
   stop — see §4.6.
5. **Cloudflare or direct?** Final answer is direct (§6.1), but confirm nobody
   else manages the DNS with a proxy already on it.
6. **Do you need `ANTHROPIC_API_KEY` compatibility**, or is
   `ANTHROPIC_AUTH_TOKEN` sufficient? Both work; know which you're documenting.

---

## Appendix — Source citations for the dual-format decisions

| Claim | Source |
|---|---|
| Translation drops `cache_control`, approximates Anthropic-only fields | [LiteLLM native passthrough docs](https://docs.litellm.ai/docs/anthropic_unified/native_passthrough) |
| `supported_endpoints` opt-in, available v1.92.0+ | same |
| `/anthropic/v1/messages` passthrough, all endpoints, streaming supported | [Anthropic passthrough](https://docs.litellm.ai/docs/pass_through/anthropic_completion) |
| `/openai_passthrough` preferred over `/openai` (route conflicts) | [OpenAI passthrough](https://docs.litellm.ai/docs/pass_through/openai_passthrough) |
| Auto URL suffix appending for custom Anthropic base | [Anthropic provider docs](https://docs.litellm.ai/docs/providers/anthropic) |
| `ANTHROPIC_API_KEY` must be empty; it's checked first | [Vercel AI Gateway — Anthropic Messages](https://blog.vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api) |
| `ANTHROPIC_AUTH_TOKEN` → Bearer; `ANTHROPIC_API_KEY` → `X-Api-Key` | [Claude Code authentication docs](https://code.claude.com/docs/en/authentication) |
| `x-api-key` legacy header still supported alongside Bearer | [Claude authentication](https://platform.claude.com/docs/en/manage-claude/authentication) |
| Cache multipliers 1.25× / 2× / 0.1× and per-model exceptions | [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| 19% under-reporting from merged cache TTL | [ccusage issue #899](https://github.com/ccusage/ccusage/issues/899) |
| v1.103.1 current stable; PEP 440 naming since v1.84.0 | [Releases](https://github.com/BerriAI/litellm/releases), [v1.84.0 notes](https://docs.litellm.ai/release_notes/v1.84.0/v1-84-0) |
| Rust core, 0.66 ms p99, ~22 MB RSS | [LiteLLM benchmarks](https://www.litellm.ai/) |
| Cosign image signing | [CI/CD v2 announcement](https://docs.litellm.ai/blog/ci-cd-v2-improvements) |
| Budgets require Postgres | [LiteLLM quickstart](https://docs.litellm.ai/docs/proxy/docker_quick_start) |