# Latency Study — what the provider's "24 ms" means, and what your
# customers will actually experience

**Status:** Analysis. Numbers are sourced below; scenario tables state their
assumptions explicitly so you can re-run them with your own measurements.
**Date:** 2026-10-11
**Companion:** `DESIGN.md` (architecture), `BLUEPRINT.md` (costs, threats).

---

## 0. The answer in one paragraph

**The provider's "24 ms" is not generation latency.** No Claude-class model
produces a first token in 24 ms — Sonnet 5 needs ~1.1 s, Opus 5.5 longer,
and Fable 5.1 (adaptive thinking always on) longer still. The 24 ms figure
is an edge/API responsiveness metric (network + API frontend), and the
98.84% is a *request success rate*, not time-based availability. Through
your gateway, a single Sonnet 5 completion will take **~2–7 seconds** end to
end, an **8-step Opus 5.5 agent ~1–4 minutes**, and a **Fable 5.1
long-horizon task several minutes to ~15 minutes** — of which your gateway
contributes roughly **5 ms**. Model generation and tool execution are
~99.9% of the wait. Everything below proves this with sourced numbers.

Our three models, and the aliases this repo serves them under:

| Alias | Model ID | Price/MTok in/out | Cache read | Thinking | Comparative latency |
|---|---|---|---|---|---|
| `fast` | `claude-sonnet-5` | $2 / $10 | $0.20 (0.10×) | Adaptive, default high | Fast |
| `smart` | `claude-opus-5-5` | $4 / $20 | $0.20 (0.05×) | Adaptive always on, default medium | Moderate |
| `frontier` | `claude-fable-5-1` | $10 / $50 | $0.25 (0.025×) | Adaptive always on, default high | Slower |

---

## Table of contents

1. [What the provider's stats actually measure](#1-what-the-providers-stats-actually-measure)
2. [Latency vocabulary](#2-latency-vocabulary)
3. [Measured model latency (independent benchmarks)](#3-measured-model-latency-independent-benchmarks)
4. [End-to-end decomposition through your gateway](#4-end-to-end-decomposition-through-your-gateway)
5. [Uptime analysis — what 98.84% means for agentic workloads](#5-uptime-analysis--what-9884-means-for-agentic-workloads)
6. [Agentic latency model + scenario tables](#6-agentic-latency-model--scenario-tables)
7. [Prompt caching effect, quantified](#7-prompt-caching-effect-quantified)
8. [What to promise your customers](#8-what-to-promise-your-customers)
9. [Measurement plan](#9-measurement-plan)
10. [Recommendations](#10-recommendations)
11. [Sources](#11-sources)

---

## 1. What the provider's stats actually measure

### 1.1 "24 ms latency"

Provider dashboards in the OpenRouter style track two different things and
label them loosely:

| Metric | What it is | Typical magnitude |
|---|---|---|
| **API / edge latency** | Time from request arrival to first response byte of the *HTTP layer* — DNS, TLS, routing, auth, queue admission. No model compute. | **10–200 ms** depending on geography |
| **TTFT** (time to first token) | Above **plus** queue wait **plus** prompt prefill (the full forward pass over your input). Model compute. | **0.3–150 s** depending on model and prompt |
| **Total** | TTFT **plus** full decode of every output token. | **seconds to minutes** |

A 24 ms figure sits squarely in the first row. It is consistent with
independent edge measurements of `api.anthropic.com` — median 176 ms
globally, 101 ms from North America, with DNS+TCP+TLS alone accounting for
~17 ms — and inconsistent with *every* published generation measurement (see
§3, where the fastest Anthropic model needs 630 ms to first *answer* token).

There are three plausible precise definitions, and they barely matter — all
three exclude generation:

1. Mean/median HTTP TTFB (time to first byte) of the API frontend.
2. Internal routing overhead (auth + rate-limit + dispatch), measured inside
   the provider's network where RTT ≈ 0.
3. A rolling average over all requests, dominated by tiny/fast-path responses
   (errors, cached, `/models` listings).

**Consequence:** if you quote "24 ms" anywhere customer-facing, you are
quoting a number that describes none of your customers' experience. §8
covers what to quote instead.

### 1.2 "98.84% uptime · 30d"

OpenRouter's documented definition for providers:

> "Your endpoint's uptime is calculated as: **successful requests ÷ total
> requests (excluding user errors).**"

So 98.84% is a **request success rate over a 30-day window**, not "the
service was reachable 98.84% of the time." The distinction matters because
the failure math (§5) is per-request, and per-request failure compounds
across agentic multi-step tasks.

Converted anyway, for intuition:

| Interpretation | Math | Result |
|---|---|---|
| As downtime budget | 1.16% × 30 d × 24 h × 60 min | **≈ 501 min ≈ 8 h 21 min per 30 days** |
| Annualised | 1.16% × 365 d | **≈ 4.2 days/year (≈ 102 h)** |
| As failure rate | 1 − 0.9884 | **≈ 1 in 86 requests fails** |
| Equivalent "nines" | — | **below two nines** (99% = 3.65 d/yr downtime) |

Two nines from the provider is normal for LLM APIs. It is not a number you
can improve — but §5 shows it dominates your error budget, and §10 shows how
to stop it dominating your *latency* budget.

---

## 2. Latency vocabulary

One request, streaming, decomposed the way every major provider measures it:

```
client ──► network ──► queue ──► prefill ──► token₁ ──► token₂ … ──► tokenₙ
           │           │         │            │                       │
           └─ transit ─┘         └─ TTFT ─────┘                       │
                         TTFB ──►│                                   │
                                                                 TTLT ◄─┘
```

| Term | Definition | Dominated by |
|---|---|---|
| **TTFB** | Request sent → first byte received | Network + API frontend |
| **TTFT** | Request sent → first *token* | Transit + queue wait + prefill |
| **TTFA** | Request sent → first *answer* token | TTFT + reasoning/thinking time |
| **TBT / ITL** | Mean time between consecutive tokens | Decode speed (1 ÷ TPS) |
| **TPS** | Output tokens per second | Model + serving stack |
| **TTLT** | Request sent → last token | The number the user feels on non-streamed calls |

The two formulas every provider publishes, in equivalent forms:

```
Total  = TTFT + (output_tokens ÷ TPS)                    (OpenRouter)
TTLT   = TTFT + (TBT × tokens_generated)                 (Azure)
```

Two properties of these formulas run the whole study:

1. **TTFT is prompt-size-dependent, TPS is not.** A 100k-token context
   inflates the first term and leaves the second untouched. Caching attacks
   the first term only (§7).
2. **Streaming changes perceived latency, not total latency** — framing
   overhead adds ~5–10% to generation time, but the user sees output after
   TTFT instead of after TTLT. For interactive use this is always worth it.
   Your gateway must therefore never buffer (§4.3, DESIGN.md §6).

For reasoning models, TTFT and TTFA diverge catastrophically: the "first
token" is a thinking token the user never sees. **Quote TTFA, not TTFT, for
any reasoning model** — otherwise your dashboard will show 18 s and your
users will feel 60 s.

---

## 3. Measured model latency (independent benchmarks)

All figures below are third-party measurements, not vendor claims — except
where marked "Anthropic", which is the vendor's comparative rating. Our
three models, and the aliases this repo serves them under:

| Alias | Model ID | Price/MTok in/out | Cache read | Thinking | Comparative latency |
|---|---|---|---|---|---|
| `fast` | `claude-sonnet-5` | $2 / $10 | $0.20 (0.10×) | Adaptive, default high | Fast |
| `smart` | `claude-opus-5-5` | $4 / $20 | $0.20 (0.05×) | Adaptive always on, default medium | Moderate |
| `frontier` | `claude-fable-5-1` | $10 / $50 | $0.25 (0.025×) | Adaptive always on, default high | Slower |

Models move; re-check quarterly. The point of these tables is the *orders
of magnitude*, which are stable.

### 3.1 Our three models (Artificial Analysis + Anthropic docs, 2026)

| Model (`alias`) | TTFA, default effort | Output speed | 500-token E2E ≈ |
|---|---|---|---|
| Sonnet 5 (`fast`) | **1.09 s** (non-reasoning config) | ~79–139 t/s class | **~5–7 s** |
| Opus 5.5 (`smart`) | unmeasured at default medium; bounded above by Opus 5 max-effort **46.18 s** (§3.2) | **92 t/s** (max config) | **~7–10 s** at low effort; **~1–4 min** at high effort |
| Fable 5.1 (`frontier`) | **unpublished — measure before promising** (vendor: "Slower", thinking always on, default high) | unmeasured; frontier class | **unknown — §6.4 gives the bounding method** |

Reference points: Haiku 4.5 (non-reasoning) 0.63 s TTFA; Sonnet 5.5 (low)
1.05–1.16 s; daily tracker (N=5, small prompt): claude-3-5-haiku TTFT p50
312 ms / p95 489 ms. OpenRouter's front page shows Sonnet-class "latency"
as ~1.8 s — seconds, never milliseconds.

### 3.2 Reasoning effort — the agentic-model case (Artificial Analysis)

Adaptive thinking is default-on or always-on in all three of our models.
Effort level is a latency dial with a 100× range:

| Config | TTFT (= first *thinking* token) | Output speed | E2E, 500 tokens |
|---|---|---|---|
| Sonnet 4.5 (reasoning, reference) | **12.48 s** | 45 t/s | ~25 s |
| Opus 4.7 (max effort, reference) | **18.34 s** | 52 t/s | ~30 s |
| Opus 5 (max effort — upper bound for `smart`) | **46.18 s** | 55 t/s | **~55 s** |
| Sonnet 5 (max effort — upper bound for `fast`) | **150.02 s** | 79 t/s | **~156 s** |
| Fable 5.1 (high, default — `frontier`) | unpublished | unpublished | **measure it (§9)** |

Read the Sonnet 5 row twice: at *max* effort, two and a half minutes
*before the first answer token*. Default effort (high/medium) will be far
below these maxima — but nothing published says how far. **Any
customer-facing estimate for `smart` or `frontier` that uses non-reasoning
TTFT is wrong by an order of magnitude or more.** Quote TTFA at the effort
you actually allow, measured by you.

### 3.3 API edge latency (APIContext, Jun 2026, `api.anthropic.com`)

| Percentile | Latency | Breakdown (latest snapshot) |
|---|---|---|
| p50 | **176 ms** | DNS 3.27 · TCP 5.77 · TLS 8.36 · process 193.5 ms |
| p95 | **329 ms** | — |
| p99 | **425 ms** | — |
| Pass rate | 100% | — |

Regional medians: North America 101 ms → Europe 172 ms → Asia 260 ms →
Africa 323 ms. **Geography alone spans a 3× range on the edge term** — which
is why §10.1 (VPS placement) is the highest-leverage latency decision you
make.

### 3.4 What this says about "24 ms"

The fastest model needs 630 ms to first answer token; the API edge alone
needs ~100–330 ms depending on continent. A 24 ms provider stat cannot
contain model compute and barely contains a transatlantic round trip. It is
an infrastructure-health number. Treat it as such.

---

## 4. End-to-end decomposition through your gateway

### 4.1 The hop diagram with measured magnitudes

```
client
  │ ① client ──► VPS : one RTT (10–150 ms by geography; §3.3)
  ▼
Caddy  (:443 → 127.0.0.1:4000)
  │ ② TLS termination + reverse proxy: ~0.5–2 ms typical,
  │   p50 ~12 ms under synthetic 100k-req load (not your regime)
  ▼
LiteLLM (:4000)
  │ ③ key auth (Redis hit) + budget check + rate limit + route: ~1–8 ms
  │   ─ Python path ≈ 7.5 ms/req overhead (LiteLLM's own measurement)
  │   ─ Rust core ≈ 0.05 ms/req overhead
  │   ─ every response carries x-litellm-overhead-duration-ms: read it
  ▼
upstream (VPS ──► provider region: one RTT, 5–120 ms by geography)
  │ ④ queue wait + prefill + decode  ← 99%+ of the total (see §4.2)
  ▼
stream back through ③②① unbuffered (flush_interval -1)
```

### 4.2 The budget, in numbers

Single request, Sonnet 5, 500 output tokens, EU VPS →
US provider, warm keep-alive connections:

| # | Component | Typical | Notes |
|---|---|---|---|
| ① | Client → VPS RTT | 20–60 ms | Geography. Yours to choose (§10.1) |
| ② | Caddy | ~1 ms | Sub-ms idle; TLS resume ~0 with keep-alive |
| ③ | LiteLLM | ~3 ms | Verify via `x-litellm-overhead-duration-ms` |
| ④a | VPS → upstream RTT | 80–100 ms | EU→US. Same-region: ~5–15 ms |
| ④b | Queue + prefill (TTFT component) | ~900 ms | §3.1 |
| ④c | Decode 500 tok @ ~95 t/s | ~5,300 ms | The dominant term, always |
| **Total** | | **≈ 6.4 s** | **Gateway share: ~0.06%** |

Change to Sonnet 5, 200 output tokens: TTFT ~1.2 s + decode ~2 s
+ network ~0.2 s ≈ **~3.4 s**. Change to Opus 5.5 at high effort, 2,000
reasoning+output tokens: TTFA ~46 s + decode ~36 s + network ≈ **~82 s
for one step**.

The gateway's contribution is three orders of magnitude below the model
term. **Anyone proposing to optimise gateway latency before model selection,
caching, and geography is optimising the wrong layer.**

### 4.4 Your plan's fine print, translated to latency

"Top priority, larger API limit" and "unlimited use (fair use applies)" act
on exactly one term of the budget above: **④b queue wait**.

- **Priority** shrinks the queue term. It does not touch prefill, decode,
  network, or tools. Expect better TTFT p95 (fewer queue spikes), not
  better decode speed or lower medians.
- **Fair use** is an undisclosed rate limit. When you cross it, the
  provider throttles — which surfaces as queue-wait spikes and 429s, i.e.
  sudden TTFT p95 blowouts with a flat median. This is the signature to
  alert on (§9 dashboard: provider error rate per hour + TTFT p95 per
  model per day).
- Because the fair-use ceiling is unpublished, **configure your per-key
  TPM as if the upstream limit were 50–70% of the largest published tier
  for these models, then raise it from your own measurements.** A tenant
  tripping the provider's hidden limit degrades *every* tenant sharing
  the upstream key — your TPM caps are what isolate them.
- 429s from fair-use throttling feed the router cooldowns
  (`allowed_fails: 3`, `cooldown_time: 60` in `config/litellm.yaml`),
  which is the mechanism that converts throttling into queued latency
  rather than hard errors. Watch that it is actually engaging: sustained
  429s with no cooldown entries means the errors are bypassing the
  router's classification.

### 4.3 The four gateway-side latency traps (all cheap, all real)

1. **Buffering.** One missing `flush_interval -1` converts TTFT into TTLT
   from the client's perspective — a 1 s first token becomes a 6 s wait.
   Covered by acceptance test A-9.
2. **Cold TLS + cold DNS per request.** Without keep-alive on both legs
   (client→Caddy, LiteLLM→upstream), every request pays ~3 RTTs of
   handshake before byte one. Caddy keep-alives to clients by default;
   verify LiteLLM's transport reuses upstream connections under your load.
3. **Key validation on the slow path.** LiteLLM checks Redis first, Postgres
   on miss. If Redis is down or evicting, every request pays a Postgres
   round trip (~1–5 ms) — invisible in averages, visible in p99. Monitor
   `x-litellm-overhead-duration-ms` p99, not mean.
4. **Uvicorn queue wait.** LiteLLM's own troubleshooting guide: if requests
   queue in the event loop before the handler starts, that wait appears in
   *no* LiteLLM log. Watch `in_flight_requests` (`/health/backlog`,
   Prometheus gauge). This is the "mystery latency" that appears at ~50+
   concurrent streams on a small VPS.

---

## 5. Uptime analysis — what 98.84% means for agentic workloads

### 5.1 Single-request view

1.16% of requests fail (provider-side; user errors excluded). ~1 in 86.

### 5.2 Agentic compounding — the important math

An agentic task is a *chain*: step N+1 needs step N's output. One failed
step fails or retries the chain.

```
P(clean N-step run) = 0.9884^N

N = 1  →  98.8%   (single chat)
N = 5  →  94.3%
N = 8  →  91.1%   (TraceLab mean: 8.8 LLM calls/request)
N = 15 →  83.9%   (Copilot median session: 15 calls)
N = 40 →  62.7%   (Copilot mean session: 40.6 calls)
```

At the TraceLab mean of ~9 LLM calls, **roughly 1 in 11 agentic tasks hits
at least one provider failure** — before your gateway, your code, or your
VPS contributes a single error. This is normal. It is why retries exist.

### 5.3 Retries convert errors into latency

With one retry per step (retry only the failed step, not the chain):

```
per-step success with 1 retry = 1 − 0.0116² ≈ 99.9865%
P(clean 8-step run)           ≈ 99.89%
```

Cost: the failed attempt's elapsed time (usually TTFT + partial decode, then
the error) is added to that step — typically +1–5 s on a non-reasoning
model, +30–150 s if a reasoning step fails late. **Set per-step timeouts
aggressively** (§10.4): a fast failure retried is cheap; a 150 s reasoning
attempt that dies at 149 s is the most expensive event in your system.

### 5.4 Compounded availability (provider × you)

```
A_total = A_provider × A_gateway × A_vps

Example: 0.9884 × 0.999 × 0.999 ≈ 0.9864  (~98.6%)
```

Your infrastructure can only *subtract* from 98.84%. A single VPS at ~99.9%
costs you ~0.1 point. The provider is 99% of your error budget — spend
reliability effort on retry policy and fallback, not on a second VPS.

### 5.5 Retry storms

The failure mode to actually fear: provider blips → all your tenants'
agents retry simultaneously → your TPM/RPM limits trip → retries queue →
recovery takes 10× longer than the blip. Mitigations: jittered exponential
backoff, per-tenant concurrency caps (you already have
`max_parallel_requests`), and a circuit breaker that fails fast to a cached
or degraded response when the provider error rate crosses ~5% over 5 min.

---

## 6. Agentic latency model + scenario tables

### 6.1 The model

```
T_task = T_init + Σ_steps [ TTFT_i + (out_i ÷ TPS) + T_tool_i ] + T_retries
```

Measured splits from real traces (TraceLab: 4,300 sessions, 350k steps;
Copilot: 3.2M users, 761M calls; AgentCgroup: 144 SWE tasks):

| Fact | Source |
|---|---|
| Mean ~8.8 LLM calls + ~10.8 tool calls per request | TraceLab |
| Median request 38 s, mean 4.3 min, p90 6.4 min | TraceLab |
| Median session 15 calls / 4.2 min; mean 40.6 calls / 62.6 min | Copilot prod |
| Tool execution ≈ 60% of response time, generation ≈ 40% | TraceLab |
| OS-level (init + tools) = 56–74% of task latency | AgentCgroup |
| Mean tool latency 16.8 s, heavily tailed (Bash median <1 s, sub-agents ~100 s) | TraceLab |
| SWE-task wall time 5–11 min end to end | AgentCgroup |

The single most surprising row: **the model is the minority of the wait.**
Tools and orchestration are ~60%. Your gateway cannot fix a customer's slow
Bash tool — but your dashboard can *show* them the split (§8), which is why
per-step timing belongs in your usage records.

### 6.2 Scenario tables

Assumptions (stated so you can substitute): EU VPS → US upstream (90 ms
RTT), client → VPS 40 ms, keep-alive warm, gateway overhead 4 ms total,
streaming on, no failures. Tool times are per-step means for a coding-agent
profile (fast file ops + occasional shell).

**Scenario A — Sonnet 5 (`fast`), simple Q&A agent, 4 steps**

| Step component | Per step | ×4 |
|---|---|---|
| TTFT (1.09 s model + ~0.13 s network) | 1.2 s | 4.9 s |
| 250 out tokens @ ~100 t/s | 2.5 s | 10 s |
| Tool (read/grep class) | 0.5 s | 2.0 s |
| **Task total** | | **≈ 17 s** |

**Scenario B — Sonnet 5 (`fast`), standard coding agent, 8 steps**

| Step component | Per step | ×8 |
|---|---|---|
| TTFT (1.09 s model + ~0.13 s network) | 1.2 s | 9.8 s |
| 400 out tokens @ ~100 t/s | 4.0 s | 32 s |
| Tool (mixed, incl. tests) | 1.5 s | 12 s |
| **Task total** | | **≈ 54 s** |

Matches the TraceLab median (38 s) to mean (4.3 min) band. This is the
"normal" agentic experience your customers will have.

**Scenario C — Opus 5.5 (`smart`), 8 steps, high effort**

Upper bound using the measured Opus 5 max-effort reference (46.18 s TTFT,
55 t/s). Default-medium effort should land well under this — measure it:

| Step component | Per step | ×8 |
|---|---|---|
| TTFA (46 s thinking + network) | 46 s | 368 s |
| 2,000 reasoning+output tok @ ~55 t/s | 36 s | 288 s |
| Tool | 2 s | 16 s |
| **Task total (upper bound)** | | **≈ 11 min** |

Matches the observed p90+ tails (6.4 min and beyond). Thinking tokens are
billed as output tokens — at $20/MTok for Opus 5.5, this scenario is also
~10× the cost of Scenario B per step, before the extra steps long tasks
take.

**Scenario D — Scenario B with prompt caching (10k stable prefix, 80% hits)**

Cache reads cut TTFT 13–31% on agentic workloads (measured, §7):

| | No cache | Cached |
|---|---|---|
| TTFT per step | 1.2 s | ~0.85 s |
| Task total | ~54 s | **~50 s** |

**Scenario E — Fable 5.1 (`frontier`): bounding the unknown**

No independent TTFA/TPS published. Bound it instead of guessing:

| Bound | Value | Basis |
|---|---|---|
| TTFA lower bound | ≥ Opus 5 max-effort 46 s | Vendor rating "Slower", always-on thinking, default high |
| Decode upper bound | ≤ ~92 t/s | Cannot exceed the fastest measured Anthropic speed |
| Cost per step (2k thinking+out, 10k cached in) | ≈ $0.0025 + $0.10 ≈ **$0.10** | $10 in / $50 out / $0.25 read |
| First action | `make latency MODEL=frontier SAMPLES=50` | Replace bounds with measurements before promising anything |

Rule: **do not put `frontier` on a customer-facing latency SLA until
Scenario E's bottom row is filled in with your own numbers.** Cost is known
($10/$50); latency is not.

Caching saves more *money* (45–80%) than *time* here, because decode
dominates. On 150k-token contexts the TTFT win reaches ~67% and the time
saving becomes material. Price it accordingly (PLATFORM.md §4.4).

### 6.3 Reading the tables

- Steps multiply everything. Halving step count (better prompts, parallel
  tool calls — currently only ~1.2 tools/step, rarely parallelised) beats
  any infrastructure optimisation.
- Reasoning effort is a latency dial with 100× range (Sonnet 5: 1.09 s
  default → 150 s at max effort). Expose it per key, default it low.
  `frontier` stays on high — which is why it is a separate alias with a
  separate (measured, not estimated) SLA.
- Your gateway's 4 ms appears nowhere above. That is the point.

---

## 7. Prompt caching effect, quantified

| Finding | Magnitude | Source |
|---|---|---|
| TTFT improvement, agentic tasks, 10k-token prompts | **13–31%** | DeepResearchBench, 500+ sessions |
| TTFT reduction, short prompts (1k tokens) | **~7%** | OpenAI cookbook, 2,300 prompts |
| TTFT reduction, long prompts (150k+ tokens) | **~67%** | same |
| Upper bound (GPU, long docs) | **up to 8×** | Prompt Cache paper |
| Cost reduction, agentic | **45–80%** | DeepResearchBench |
| 5-min vs 1-h TTL latency difference | **none** | Anthropic docs — TTL is cost-only |

Three operational consequences:

1. **Caching is a cost feature first, latency feature second** — except on
   long contexts, where it becomes both.
2. **Cache entries become available only after the first response
   begins.** Parallel fan-out at session start gets zero hits; sequence the
   first call, then parallelise. Document this for your tenants.
3. **The 5-min/1-h TTL choice does not affect latency at all.** It is purely
   the 1.25× vs 2× write-price decision from BLUEPRINT.md §8. Do not let
   anyone "upgrade to 1h for speed."

---

## 8. What to promise your customers

Never publish the provider's 24 ms. Publish **your** measured numbers, by
scenario, as ranges with percentiles:

```
Single completion (`fast` = Sonnet 5, ≤500 out tokens)
  first token   p50 ~1.2 s    p95 ~2.5 s
  complete      p50 ~6.5 s    p95 ~12 s

Agentic task (`fast`, 8 steps, mixed tools)
  complete      p50 ~1 min    p95 ~5 min

Deep reasoning (`smart` = Opus 5.5, high effort)
  first answer  p50 ~45 s     p95 ~3 min
  complete      see estimate per task — varies 5–15 min

Frontier (`frontier` = Fable 5.1)
  NO published numbers until you measure (§6 Scenario E).
  Never put this row on an SLA with estimates in it.
```

Rules:

- **Percentiles, not means.** p95 is what support tickets are made of
  (a 379 ms mean can hide 2 s tails).
- **TTFA for reasoning models**, TTFT otherwise. Label which.
- **State the exclusions**: customer tool time, customer network, provider
  incidents. Your SLA covers your gateway (target: 99.9% monthly, i.e.
  ~43 min downtime) — it cannot cover the provider's 98.84%.
- **Show the split in the dashboard**: model vs tool vs network per task.
  When a customer complains, the chart should answer before you do.

---

## 9. Measurement plan

Measure each layer separately, continuously, in percentiles. The tooling
already exists in this repo:

| Layer | How | Where |
|---|---|---|
| Client → VPS | `curl -w` DNS/connect/TLS/TTFB | `scripts/measure-latency.sh` |
| Caddy | `{http.reverse_proxy.upstream.latency_ms}` placeholder in access log | Caddyfile `log` block |
| LiteLLM | **`x-litellm-overhead-duration-ms`** on every response — collect p50/p99 | same script |
| Upstream queue+prefill | TTFT minus (①+②+③+④a) | derived |
| Decode | total − TTFT, ÷ output tokens → effective TPS | same script |
| Provider truth | Artificial Analysis provider pages; OpenRouter generation `provider_latency` | quarterly review |

`scripts/measure-latency.sh` (added with this study):

```bash
./scripts/measure-latency.sh \
  --base https://api.yourdomain.com \
  --key  sk-... \
  --model fast \
  --samples 50
# prints p50/p95 for: dns, tcp, tls, ttft, total, effective tps,
# plus p99 of x-litellm-overhead-duration-ms
```

Run it weekly from two locations (near the VPS, and where your customers
are) and append to a CSV. Four weeks of that file is your SLA evidence and
your "is it us or the provider?" answer.

Minimum dashboard (portal, v1): TTFT p50/p95 per model per day; total p50/p95
per model per day; LiteLLM overhead p99; provider error rate per hour. Six
panels. Anything else waits until someone asks.

---

## 10. Recommendations

Ordered by expected impact. The first three are worth more than the rest
combined.

### 10.1 Put the VPS in the provider's region (impact: 50–200 ms per request, every step)

The edge table (§3.3) shows a 3× continental spread before any model runs.
Every agentic step pays the VPS→upstream RTT at least twice (request +
stream). Same-region placement (e.g. US VPS for a US-served provider) removes
~80–100 ms per step — ~1 s off an 8-step task for zero code. Verify the
provider's serving region with `measure-latency.sh` from candidate VPS
locations *before* signing a contract.

### 10.2 Keep connections warm on both legs (impact: 2–4 RTTs per request)

Client→Caddy keep-alive is default. Confirm LiteLLM→upstream connection
reuse under load (watch for TLS handshake time reappearing in slow-request
traces). Cold handshakes cost more than your entire gateway overhead.

### 10.3 Make caching the default posture (impact: −13–31% TTFT, −45–80% cost)

Stable system prompts, tool definitions first, `cache_control` breakpoints
set, 5-min TTL unless sessions genuinely idle longer. Verify with smoke
test A-6 (non-zero `cache_read_input_tokens`), not by assumption.

### 10.4 Timeouts and retries (impact: converts 11%-of-tasks failures into seconds)

- Per-step timeout: 120 s non-reasoning, 600 s reasoning. A late failure is
  the most expensive event in the system (§5.3).
- One retry per failed step with jittered backoff — not per chain.
- Circuit breaker at ~5% provider errors / 5 min: fail fast, serve degraded,
  recover without a retry storm (§5.5).

### 10.5 Model routing by latency class (impact: up to 100× on TTFA)

`fast` (Sonnet 5) for interactive steps, `smart` (Opus 5.5) for hard
steps, `frontier` (Fable 5.1) only on explicit request. The aliases in
`config/litellm.yaml` exist precisely so you can move tenants between
latency classes without touching their code.

### 10.6 Concurrency, not heroics (impact: tail latency under load)

`max_parallel_requests` per key (already in your key template) plus the
`in_flight_requests` monitor (§4.3.4). The failure mode is queue wait that
appears in no log — instrument it before you need it.

### 10.7 What NOT to do

- Do not add a CDN "for speed." It adds a trust boundary (§6.1 DESIGN.md)
  and ~zero measurable gain on API traffic dominated by generation.
- Do not chase gateway microseconds while steps take seconds. Re-read §4.2.
- Do not publish single-number latency. Percentiles or nothing.

## 12. What this repo already implements (recommendation → location)

| LATENCY.md §10 | Status | Where |
|---|---|---|
| §10.1 same-region VPS | **Operator action** | `make latency` from candidate regions before signing |
| §10.2 warm connections | ✅ Done | Caddy keep-alive pool; LiteLLM transport reuse (verify under load) |
| §10.3 caching by default | ✅ Enforced | A-6 smoke test; `cache_control_ttl: true` on openai/ deployments |
| §10.4 timeouts + retries | ✅ Done | Per-deployment `timeout`; `num_retries: 2` + `retry_after: 1`; cooldowns; no `fallbacks` block (single upstream) |
| §10.4 circuit breaker | ✅ Partial | Cooldowns are the automatic half; add the 5%-errors alert in the portal (§11) |
| §10.5 latency classes | ✅ Done | `fast` / `smart` aliases; move tenants without touching client code |
| §10.6 concurrency caps | ✅ Done | Per-key `max_parallel_requests` (default 3); router `default_max_parallel_requests: 100` for ~120 dev users |
| §9 measurement | ✅ Done | `scripts/measure-latency.sh` + `make latency`; `log_append` split in Caddy logs |
| DEBUG-logging trap | ✅ Done | `LITELLM_LOG=ERROR` in compose |
| Uvicorn queue wait | ✅ Mitigated | `NUM_WORKERS=2`; monitor `in_flight_requests` |

Rejected with reason: `latency-based-routing` (breaks endpoint affinity,
§4.2); CDN "for speed" (§10.7); `stream_timeout` (would kill long streams);
`fallbacks:` to the same upstream (a second full-price call that cannot
succeed where the first failed).

---

## 11. Sources

| Claim | Source |
|---|---|
| Uptime = successful ÷ total requests (excl. user errors) | [OpenRouter provider docs](https://openrouter.ai/docs/guides/community/for-providers) |
| Total = TTFT + output÷TPS; TTFT = transit + queue + prefill | [OpenRouter latency guide](https://openrouter.ai/docs/guides/best-practices/latency-and-performance) |
| TTLT = TTFT + TBT × tokens; metric definitions | [Azure latency docs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/latency) |
| Claude TTFA/TPS: Haiku 0.63 s, Sonnet 5 1.09 s, Sonnet 5.5 up to 139 t/s | [Artificial Analysis — Anthropic](https://artificialanalysis.ai/providers/anthropic) |
| Reasoning TTFT: Opus 4.7 18.34 s, Sonnet 4.5 12.48 s, Opus 5 46.18 s, Sonnet 5 150.02 s | [AA comparisons](https://artificialanalysis.ai/models/comparisons/claude-opus-5-vs-claude-sonnet-5) |
| Model-page "latency" in seconds (e.g. Sonnet 4: 1.8 s) | [OpenRouter front page](https://openrouter.ai/) |
| Edge: p50 176 ms, p95 329 ms, p99 425 ms; regional spread | [APIContext — Anthropic](https://apicontext.com/api-directory/artificialintelligence/anthropic) |
| Haiku TTFT p50 312 ms / p95 489 ms | [llm-latency-tracker](https://github.com/kira-autonoma/llm-latency-tracker) |
| LiteLLM adds 0.00325 s vs raw API | [LiteLLM perf docs](https://docs.litellm.ai/docs/proxy/perf) |
| Rust core 0.05 ms overhead; Python path ~7.5 ms | [LiteLLM Rust benchmark](https://docs.litellm.ai/blog/sub-millisecond-proxy-overhead) |
| `x-litellm-overhead-duration-ms` on every response | [LiteLLM benchmarks](https://docs.litellm.ai/docs/benchmarks) |
| Queue wait invisible to LiteLLM logs; check `in_flight_requests` | [LiteLLM latency troubleshooting](https://docs.litellm.ai/docs/troubleshoot/latency_overhead) |
| 8.8 LLM calls + 10.8 tools/request; mean 4.3 min, median 38 s, p90 6.4 min; tools ≈ 60% | [TraceLab](https://arxiv.org/html/2606.30560v1) |
| Sessions: median 15 calls/4.2 min; mean 40.6 calls/62.6 min | [Copilot production study](https://arxiv.org/html/2608.00101v1) |
| OS-level 56–74% of task; tasks 5–11 min | [AgentCgroup](https://arxiv.org/html/2602.09345v2) |
| Caching: −13–31% TTFT, −45–80% cost, agentic | [Don't Break the Cache](https://arxiv.org/html/2601.06007v1) |
| Caching: up to −80% TTFT; 7% @1k → 67% @150k tokens | [OpenAI prompt caching cookbook](https://developers.openai.com/cookbook/examples/prompt_caching_201) |
| 5-min vs 1-h TTL: no latency difference | [Claude prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Caddy p50 ~12 ms under 100k-req synthetic load | [Proxy benchmarks](https://github.com/NickMRamirez/Proxy-Benchmarks) |
| Streaming +5–10% total, −80% perceived latency | [DadOps LLM benchmarks](https://daddaops.github.io/dadops-site/blog/llm-api-latency-benchmarks/index.html) |
| Always review p50/p75/p95, pair latency with token counts | [OpenAI latency troubleshooting](https://help.openai.com/en/articles/1000499-troubleshooting-api-errors-and-latency) |