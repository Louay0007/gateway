# Zaino gateway — performance audit

Endpoint audited: `https://api.zaino.soon.it` (15.224.52.176, AWS eu-west-3 Paris)
Upstream: `https://aipilot-weld.vercel.app/v1` (Vercel edge)
Method: live measurement against production, plus paired A/B against the upstream
directly so gateway cost is separated from inference cost. Dates: Nov 2, 2026.

---

## Verdict

The gateway is **not** the bottleneck. Its own added latency is below the noise
floor of the thing it proxies. Two real defects sit around it, and one of them is
serious enough that it is currently shipping empty answers.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | `reasoning_effort: max` consumes the entire `max_tokens` budget, so constrained requests return no answer | **Critical** | 6/6 empty at 256/512/1024 |
| 2 | `encode zstd gzip` compresses SSE, degrading token delivery ~10x | **High** | 23.9ms vs 2.3ms median gap |
| 3 | Retry policy can fan a single request into many billable upstream calls | **High** | config math, 6×2×2 |
| 4 | Reasoning is 53–80% of every reply; the effort dial barely moves it | **Medium** | 1417 tok at `none`, 1183 at `max` |
| 5 | Edge buffers a 2MB body for ~1.2s before forwarding | **Low** | 1.13–1.39s to 400 |
| 6 | Cold TLS connect costs 1.1s in the first request of a connection | **Low** | run1 1.13s vs run5 0.24s |

---

## 1. Gateway overhead is effectively zero

This was the headline question and the answer required a paired test, because an
unpaired A/B produced a false result.

**Unpaired, n=5** — suggested the gateway added 575ms p50:

```
DIRECT       first-token p50=1156ms
VIA GATEWAY  first-token p50=1731ms
```

That number is an artifact. Upstream latency drifts by hundreds of milliseconds
between runs, so two sequential samples measure the drift, not the proxy.
Alternating the two paths pair-by-pair removes it:

**Interleaved paired A/B, n=14 pairs, same upstream, same prompt:**

```
DIRECT   first-token p50=1366ms  min=844ms
GATEWAY  first-token p50=1208ms  min=979ms

Paired delta per pair: mean=40ms  sd=346ms  stderr=92ms
Deltas: 950, -319, 257, -442, 207, -199, -327, 138, -277, -50, 78, 178, 40, 321
-> not distinguishable from zero
```

The gateway is inside the noise. Corroborating evidence, each hop isolated:

| Layer | Fixed cost | How measured |
|---|---|---|
| auth-edge `zn-` → `sk-` | ~1–2ms | pure `node:http` pipe, keep-alive pool |
| LiteLLM routing + Redis | 15–45ms | request rejected as bad model, never reaches inference |
| Redis `PING` | 0.5–1.0ms | from inside the litellm container |
| Caddy | <1ms | proxy + flush_interval -1 |

`edge/server.mjs` is genuinely lean: no per-request network call, no JSON
re-serialization on the hot path, `keepAlive: true` with 256 sockets so the
loopback hop is not re-handshaked, and streamed responses are `pipe()`d rather
than buffered.

The one structural cost is architectural, not code: the VPS is in Paris (123ms
RTT from this client) and the upstream is on Vercel (58ms). Every token crosses
two WAN spans instead of one. That is worth ~65ms of pure propagation per
first token — real, but an order of magnitude smaller than the inference time it
wraps.

---

## 2. Critical: constrained requests return nothing

Every alias pins `reasoning_effort: max` (`config/litellm.yaml`). On this
upstream, reasoning tokens are billed against `max_tokens`. So when a client sets
a modest `max_tokens`, the model spends the entire budget thinking and never
emits an answer.

**Through production, with only `max_tokens` set:**

```
max_tokens=256   finish=length  completion=256  reasoning=256  EMPTY 2/2  2760ms
max_tokens=512   finish=length  completion=512  reasoning=512  EMPTY 2/2  4168ms
max_tokens=1024  finish=length  completion=1024 reasoning=1024 EMPTY 2/2  7462ms
```

Reasoning is **100% of completion** at every one of those sizes. `finish_reason`
is `length`, the answer string is empty, and the request is billed in full. The
customer waits 7.5s and receives nothing.

**With no `max_tokens` sent** — which is what the portal
(`portal/lib/chat/gateway.ts` only sends `max_tokens` when `maxOutputTokens` is
set) and the desktop both do — it works:

```
total=18696ms  finish=stop  completion=2821  reasoning=2257 (80%)  answer_chars=2332
```

18.7 seconds and 80% of the paid tokens spent thinking, but a usable answer. The
defect therefore bites **third-party clients** — anything that sets a sane
`max_tokens` of 256–1024, which is most SDK defaults and most agent harnesses.
They get silence, a `length` finish, and a bill.

Fix: stop pinning `reasoning_effort` at the deployment for constrained requests.
Either reserve headroom (`max_tokens` + reasoning allowance) or let the client's
`max_tokens` mean *answer* tokens by adding the reasoning budget on top. The
immediate mitigation is to cap the deployment default at `medium`/`high` and
document that `max_tokens` includes thinking.

---

## 3. High: gzip on SSE degrades token delivery ~10x

The API vhost sets `encode zstd gzip` at the top, and SSE responses carry
`content-encoding: gzip` in production. Compression cannot emit bytes until it
has a block, so each token is held back. Same production path, only
`Accept-Encoding` varied, n=5 each:

```
accept-encoding: gzip      median inter-chunk gap = 23.9ms  p90=84.2ms
accept-encoding: identity  median inter-chunk gap =  2.3ms  p90=73.4ms
```

**10.4x worse delivery latency.** On a longer stream it also moves the first
token: 1910ms gzip vs 1456ms identity p50 — 454ms of dead time added to a single
request. There is nothing to gain: an event-stream of tokens compresses to a few
percent, and the response is already chunked.

`flush_interval -1` is set correctly on the reverse_proxy, so the buffering is
gzip's, not Caddy's. The fix is to exempt event-streams from compression:

```
@notSse header Content-Type text/event-stream
encode zstd gzip {
    match { not header Content-Type text/event-stream }
}
```

or simply match on request path `/v1/chat/completions` and `/v1/responses`.

---

## 4. High: retry configuration can multiply one request

`num_retries` is set at three levels simultaneously:

```
litellm_params.num_retries: 6   (per deployment, all three aliases)
router_settings.num_retries: 2
litellm_settings.num_retries: 2
```

If these compose rather than override, a single client POST can become
6 × 2 × 2 = **24 upstream attempts**. With `timeout: 600` at each level, a
persistently failing request can occupy a connection for a very long time before
the customer sees an error, and each attempt is a billable model call.

`retry_policy` correctly zeroes retries for client-side errors
(`BadRequestErrorRetries: 0` etc.), which contains the blast radius to
timeout/5xx — but those are exactly the cases where retrying 24 times makes
latency worse, not better.

Also worth noting: `allowed_fails: 3` with a single deployment per alias means
three failures put the entire alias into a 60s cooldown where every tenant gets
"No deployments available". `allowed_fails_policy` mitigates this for client
errors, but a genuine upstream wobble still takes an alias out for a minute.

Set `num_retries` in exactly one place. 2 total is defensible; 24 is not.

---

## 5. Medium: reasoning dominates spend, and the effort dial is weak

Same prompt, no `max_tokens`, n=3 each, `sonnet-5.5`, measured directly so no
gateway variance:

| effort | total ms | reasoning tok | answer words | reasoning % |
|---|---|---|---|---|
| `none` | 13851 | 1417 | 364 | 72% |
| `minimal` | 18823 | 1104 | 355 | 68% |
| `low` | 16207 | 849 | 282 | 53% |
| `medium` | 12830 | 1031 | 284 | 61% |
| `high` | 9816 | 861 | 266 | 69% |
| `max` | 16283 | 1183 | 317 | 76% |

Two conclusions:

- **`none` does not disable thinking** (1417 tokens), confirming the note already
  in `litellm.yaml`. There is no off switch on this upstream.
- **The dial is not monotonic and not strongly correlated with cost.** `high`
  was both the fastest and the cheapest in this sample; `minimal` was the
  slowest. Variance within a level (±40%) is comparable to the difference
  between levels. Pinning `max` therefore buys little measurable depth over
  `high`, while paying 20–40% more reasoning tokens on every call.

Recommendation: default to `high`, not `max`. Keep `max` available per request.
Revisit only with a quality eval, since latency alone does not distinguish them.

---

## 6. Model speed matrix

Identical prompt, `effort=max`, n=4, measured directly against upstream to
exclude gateway variance. `max_tokens=800` here is *below* the reasoning budget,
so all three truncated at 800 reasoning tokens — the TTFT and decode numbers are
still valid, the totals are not representative.

| alias | model | TTFT p50 | decode p50 | reasoning share |
|---|---|---|---|---|
| `fast` | haiku-5.5 | 1196ms | 85 tok/s | 100% (truncated) |
| `smart` | sonnet-5.5 | 984ms | 110 tok/s | 100% (truncated) |
| `frontier` | opus-5.5 | 851ms | 113 tok/s | 100% (truncated) |

Two things worth flagging to the product:

- **TTFT is nearly flat across tiers** (851–1196ms). The expensive model does not
  start answering meaningfully faster; it answers *better*, which this audit
  cannot measure. Marketing "fast" as the low-latency tier is not supported by
  time-to-first-token — the difference is inside the noise.
- **Decode is 85–113 tok/s** across all three. Output length, not model choice,
  dominates perceived speed. A `frontier` answer of 300 tokens lands sooner than
  a `fast` answer of 900.

Environment note: these were taken against a Vercel-hosted upstream from a
European client. Absolute numbers will differ by client geography; the ratios
between tiers will be more stable.

---

## 7. Low: request body buffering

`edge/server.mjs` buffers the whole body before forwarding on
`/v1/chat/completions`, because alias resolution needs to read `model`. It reads
the entire body to do so.

Measured with a 2.1MB body (a realistic long agent transcript) that the edge
rejects at the model check, so no inference runs:

```
edge read 2MB: ttfb=1.387s  total=1.388s  code=400
edge read 2MB: ttfb=1.133s  total=1.135s  code=400
```

~1.2s of pure buffering before the request can start. Over a 100Mbit residential
upload, 2MB takes ~0.17s, so roughly 1s is upload + serialization. Cap is 32MB,
which at this rate is ~18s of dead time for a client that fills it.

This is acceptable today because bodies are small, but any 32MB request costs the
client ~18s *before* the model starts. If long-transcript agent clients are the
target market, stream the body into the upstream request and parse only the
leading chunk to resolve the alias.

---

## 8. What is healthy, verified

- **Concurrency**: 24 parallel requests, 24/24 succeeded, no 429, no gateway
  errors, 5.48 req/s aggregate; at c=8, 5.08 req/s with flat TTFT (p50 1324ms vs
  1207ms single). No queueing or connection starvation at these levels.
- **Prompt caching**: works end-to-end. A repeated 2.7k-token prefix returns
  `cached_tokens: 2761` through the gateway, and TTFT drops from 1.66s to 0.85s
  on a warm cache. `cache_control` breakpoints pass through untouched. This is
  the single largest available latency win for agent workloads and it already
  works — clients should simply use it.
- **Connection reuse**: 5 sequential requests on one connection, 1 connect, warm
  TTFB 41–90ms vs 1130ms cold. `keepAliveTimeout = 65000` on the edge is correct.
- **Streaming config**: `flush_interval -1` present on all five vhosts;
  `response_header_timeout 300s` correctly sized for reasoning models (a 120s
  value would convert slow thinking into a 502 and a wasted full-price call).
- **Usage accounting**: `stream_options.include_usage` is preserved through the
  edge; `cached_tokens` is surfaced, and the existing comment about
  `prompt_tokens` already including cache reads is correct.
- **Timeouts**: `server.requestTimeout = 0` and `server.timeout = 0` are right —
  a proxy-level timeout would cut valid long generations.
- **Health endpoints**: `/health/liveliness` 200 in 5.6ms; edge health 200.

---

## Priority

1. **Fix the reasoning/`max_tokens` starvation.** It is silently returning empty
   answers to paying customers today and billing them for it. Everything else is
   an optimization; this is a correctness bug.
2. **Exclude SSE from gzip.** One directive, 10x better token delivery, 450ms off
   first token on long streams.
3. **Collapse `num_retries` to one level** so a bad request cannot become 24
   billable attempts.
4. **Retune the effort default to `high`** and document that `max_tokens`
   includes thinking.
5. **Move the VPS closer to the upstream, or the upstream closer to the VPS.**
   The Paris→Vercel span is ~65ms of unavoidable added propagation per request;
   co-locating removes it and is the only structural latency win left.
6. Stream large request bodies if long transcripts are the target.

## Reproduction

Measurement scripts are at `/tmp/perf/`: `ab.mjs` (paired A/B), `layers.mjs`
(per-hop isolation), `enc.mjs` and `stream.mjs` (compression impact),
`ceil.mjs` (concurrency), `effort.mjs` (effort dial), `budget.mjs` and
`prodcheck.mjs` (the empty-answer defect), `models.mjs` (tier matrix).

Note on methodology: the first attempt at this audit reported a 575ms gateway
overhead. It was wrong, and the mechanism is worth stating — comparing two
sequential samples of a system whose latency drifts ±400ms measures the drift,
not the difference. Only the interleaved paired test is trustworthy here.
