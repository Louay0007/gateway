# Blueprint: Per-user token, cost, and quota metering for a self-hosted LLM proxy

**Audience:** anyone running their own Anthropic (or compatible) API proxy who wants hard per-customer quotas, token accounting, and cost attribution — with IP abused handled correctly and streaming preserved.

**Status:** analysis + reference architecture, not a turnkey deploy script. Turns into one after the scaffold step.

---

## 1. What we are actually building

You asked for four things and they are all doable:

1. **Per-user token limits** — reject or queue before the upstream call when a customer would exceed their token budget.
2. **Per-user cost limits** — hard spend ceiling in USD, enforced pre-flight, not just reported after the fact.
3. **Per-request details** — every call logged with model, token counts by category, latency, status, and cost.
4. **Per-IP signal** — used for flood control and abuse detection, not for identity or billing.

The hard part is not the schema. It is the **order of operations** and the **trust boundary around client IP**. Get those wrong and your limits are decorative.

---

## 2. The two design decisions that matter more than the rest

### 2.1 Identity comes from the issued key, not from IP

IP is a terrible customer identity:

- Carrier NAT, corporate proxies, and CGNAT put many paying users behind one IP.
- One roaming user has many IPs over time.

So:

- **Quotas, token budgets, billing, and hard ceilings are keyed by your issued API key** (which maps to a tenant/user on your side).
- **IP is an abuse signal.** Use it for flood control, credential-guessing protection, and anomaly detection. Do not use it to decide how much a specific customer can spend.

### 2.2 Cache tokens are a separate line item, not "input tokens"

For Anthropic-style prompt caching, the same request can be mostly cache-read. If you count all `input_tokens` at full price, your metering will be wildly wrong.

Anthropic's current usage model for Sonnet 4 (and similar Claude models) separates:

- `input_tokens` — uncached input
- `cache_creation_input_tokens` — tokens written to cache
- `cache_read_input_tokens` — tokens read from cache
- `output_tokens` — generated tokens

Their current pricing is (verify against the live pricing page before you hard-code anything):

| Category | Per 1M tokens |
|---|---|
| Uncached input | $3.00 |
| Output | $15.00 |
| 5-minute cache write | $3.75 (1.25× input rate) |
| 1-hour cache write | $6.00 (2× input rate) |
| Cache read | $0.30 (0.10× input rate) |

So cost is:

```
cost = uncached_input_tokens        × price_in
     + cache_write_tokens           × cache_write_price
     + cache_read_tokens            × cache_read_price
     + output_tokens                × price_out
```

For a defensible ledger, **store every category separately and record the price version you used.** Do not collapse them into one "input_tokens" number if you intend to bill from that table later.

Also: cache multipliers differ by model and over time. Sonnet-class models have had lower cache-read multipliers than the 0.10× general figure on some newer tiers. Treat any multiplier as model-specific and time-bound, not as a law of physics.

---

## 3. Two-pass token accounting

You need both:

### 3.1 Pre-flight estimate — admission control

Before you spend real money upstream, estimate the request's worst-case exposure and decide whether to admit it.

- Tokenize the assembled request: system prompt, tools, messages, etc.
- Combine estimated input with the customer's `max_tokens` / output cap.
- Compute a **conservative maximum cost** using the price schedule.
- Atomically reserve that amount against the applicable budgets and rate buckets.

This is approximate. That is fine. Its job is to **stop an over-budget caller before the call**, not to produce the final invoice.

### 3.2 Post-hoc actual — the accounting record

After the upstream response, read the real usage off the response and store it. This is what you report and reconcile from.

- For non-streaming: read the final `usage` object.
- For streaming: you still need the final usage. Do not try to parse final JSON out of a live stream if you are forwarding chunks as they arrive.

The streaming problem is real and easy to get wrong.

---

## 4. Streaming without buffering the whole response

If you tee chunks straight to the client and also scrape usage, you can preserve low latency and still meter.

The correct pattern is **incremental SSE parsing on a copy of the bytes, while forwarding the original bytes immediately**, then persisting usage at stream completion.

Conceptual shape:

- Parse SSE incrementally; a single HTTP chunk is not necessarily one complete SSE event.
- On `message_start` and `message_delta`, update cumulative usage from the event's `usage` field. Do not sum repeated deltas — Anthropic documents `message_delta` usage as cumulative.
- Forward every raw chunk to the client as soon as you have it.
- On normal stream completion, persist the latest usage plus request metadata.
- If the client disconnects or the stream ends abnormally, treat available usage as incomplete/uncertain, not as a guaranteed final total.

Do not accumulate the full generated text just to get usage at the end — that defeats the point of streaming and increases your memory/exposure profile.

Also: prompt caching can be skipped below a model's minimum cache threshold. Do not assume cache counters will always be present.

---

## 5. Limits you should actually enforce

Rate limits alone do not protect you. They protect capacity, not your wallet. Combine several controls:

### 5.1 Request rate — RPM

Token bucket per scope. One token per admitted request. Refill controls sustained rate; bucket size controls burst.

### 5.2 Token rate — TPM

Debit an estimated token load at admission, reconcile to actual afterwards. Decide explicitly what "tokens" means in your policy: input, output, or their sum. Track them separately even if the admission check uses a total.

### 5.3 Concurrency

This is **simultaneous in-flight requests**, not rate. Acquire a lease before calling the provider; release it on completion, cancellation, or stream end; TTL the lease so a crashed proxy cannot strand capacity forever. Count streaming calls as in-flight until they end. Bound any wait queue, or you just move the overload from the provider to your proxy.

### 5.4 Daily/monthly spend ceiling — the one that actually matters

This is the hard stop. Rate limits cannot stop someone draining you slowly across hours or days. A ceiling with pre-call reservation can.

- Reserve conservatively before the upstream call.
- Settle to actual afterwards.
- If actual exceeds the reservation, charge the difference and block further requests once the ceiling is crossed.
- Mark uncertain outcomes explicitly instead of assuming zero cost.
- Use explicit UTC/billing-period boundaries and an auditable timestamp.

A soft warning as the customer approaches the ceiling is good UX. The final enforcement must still be a hard rejection, not a polite log line.

---

## 6. Where IP fits, and where it absolutely does not

### 6.1 Good uses of IP

- Unauthenticated flood control at the edge.
- Abuse detection: one IP suddenly using many keys, or one key suddenly appearing from many unrelated IPs.
- Rate-limiting authentication failures by source.

### 6.2 Where IP must not decide billing/quota

- Do not let one IP's behavior set or drain another customer's budget.
- Do not use IP as the primary key for spend ceilings.
- Do not assume one IP equals one user for reporting.

### 6.3 The X-Forwarded-For trap

There is no inherently trustworthy client-IP header. A client can send whatever `X-Forwarded-For` they want.

If you read `X-Forwarded-For` directly from the request without proxy hygiene, a caller can bypass your IP limits by sending `X-Forwarded-For: 1.2.3.4`.

The fix is infrastructure-side:

- At the trusted edge, **strip or overwrite any client-supplied forwarding headers before setting your own.**
- If there is another load balancer/CDN in front, trust only its actual CIDRs, not all private ranges by default.
- Prevent direct untrusted access to the backend so the forwarding chain is the only path.
- In LiteLLM terms, there are two separate trust configs: the edge's trusted-proxy config and LiteLLM's own `trusted_proxy_ranges`. Set each to the real hop(s), not to broad defaults.

Same caution applies to `CF-Connecting-IP` if you are behind Cloudflare: that header is trustworthy only because Cloudflare is your trusted edge, and only when you prevent callers from reaching your backend directly with a forged value.

---

## 7. Reference architecture

A practical deployment has three roles:

1. **Edge / reverse proxy** — TLS and safe client-IP hygiene, plus coarse unauthenticated flood control. Caddy is a good fit here.
2. **Metering / proxy core** — key auth, quotas, budgets, upstream proxying, usage capture, and logging. LiteLLM Proxy is the strongest off-the-shelf fit for this if you are OK handing it the key-management and quota surface.
3. **Metering store** — durable usage events and budget state. Postgres for the ledger; Redis for shared distributed rate/concurrency counters if you run more than one proxy instance.

If you want a lighter, more-custom path, you can replace LiteLLM with a smaller proxy and your own quota/budget service, but you will be re-implementing key issuance, budget reservation, and streaming usage capture yourself.

---

## 8. Recommended stack, concretely

For the fastest path to a real, working system with per-key budgets and spend reports:

- **LiteLLM Proxy** for key issuance, per-key `max_budget` / `budget_duration` / `rpm_limit` / `tpm_limit` / `max_parallel_requests`, model allowlists, and Postgres-backed spend logs.
- **Postgres** for the budget and spend-log store. LiteLLM needs a DB for spend budgets to actually reset and enforce; for multi-instance rate limits, add Redis or accept per-instance counters and their weaker guarantees.
- **Caddy** in front as the TLS edge, with `flush_interval -1` on the upstream so streaming stays low-latency, and correct trusted-proxy config so client IP is trustworthy where you actually use it.
- **Your own usage_events table** if you want a customer-facing billing ledger that is independent of LiteLLM internals. You can either import LiteLLM's standard logging payload into it, or persist usage yourself from the upstream response.

If you already have your own auth/tenancy system, keep LiteLLM's key issuance as the meter identity layer, and associate LiteLLM keys with your tenant/user IDs rather than trying to make LiteLLM your whole identity system.

---

## 9. LiteLLM-style config, as a reference

This is the shape of the config you are aiming for, not a copy-paste commitment to LiteLLM:

- One virtual key per customer/environment.
- Model allowlist on the key.
- Hard spend cap with a reset duration.
- RPM, TPM, and concurrency limits on the key.
- Associated user/team metadata so reports can be grouped the way your business wants.

Minimal environment shape:

- A master key for admin operations.
- A separate salt/key for encrypting stored secrets.
- The Postgres URL.
- The upstream provider key, read from an env var so the upstream URL/key is not client-controllable.

A Docker Compose skeleton would be: Postgres, LiteLLM, and Caddy on one network, with only Caddy's ports published. Pin all images to tested versions or digests. Keep `.env` out of source control. Use URL-encoded credentials if any password contains reserved characters.

---

## 10. Key issuance flow

1. Generate a high-entropy secret with a CSPRNG.
2. Store only a verifier, not the raw secret in reusable form. Keep a short non-secret prefix for identification and UI hint only.
3. Bind the key to a tenant, and optionally a user.
4. Attach scopes, model allowlist, expiry, status, and any key-level limits.
5. Show the secret once, at issuance.
6. Support revocation, rotation with brief overlap, and `last_used_at`.
7. Issue separate keys per customer/environment/workload so usage can be attributed and leaked credentials can be revoked independently.

Never let the client choose the identity used for quota enforcement. Derive tenant/user from the server-side key record.

---

## 11. Usage events schema — the one that survives provider changes

Keep raw events append-only. Keep mutable enforcement state in separate tables. Record both estimate and actual. Use integer token counts and integer minor cost units such as micro-USD, not floats, for money.

A good starting schema:

```sql
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  user_id         uuid,
  key_prefix      text NOT NULL,       -- lookup/display hint, not the secret
  verifier        bytea NOT NULL,      -- hash of the high-entropy secret
  name            text NOT NULL,
  status          text NOT NULL,       -- active, revoked, expired
  scopes          jsonb NOT NULL,      -- permissions / model allowlist
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  last_used_at    timestamptz
);

CREATE TABLE usage_events (
  event_id               uuid PRIMARY KEY,
  request_id             uuid NOT NULL,
  attempt                integer NOT NULL DEFAULT 1,
  tenant_id              uuid NOT NULL,
  user_id                uuid,
  api_key_id             uuid NOT NULL REFERENCES api_keys(id),
  occurred_at            timestamptz NOT NULL,
  provider               text NOT NULL,
  requested_model        text NOT NULL,
  actual_model           text,
  operation              text NOT NULL,
  status                 text NOT NULL,  -- success, error, uncertain
  estimated_input        bigint,
  estimated_output       bigint,
  actual_input           bigint,
  actual_output          bigint,
  cached_input           bigint,
  estimated_cost_micro_usd   bigint,
  actual_cost_micro_usd      bigint,
  price_version          text,
  usage_source           text NOT NULL,  -- provider, fallback_estimate, etc.
  idempotency_key        text NOT NULL,
  UNIQUE (tenant_id, idempotency_key, attempt),
  UNIQUE (request_id, attempt)
);

CREATE INDEX usage_events_time_idx ON usage_events (occurred_at);
CREATE INDEX usage_events_key_time_idx ON usage_events (api_key_id, occurred_at);
CREATE INDEX usage_events_model_time_idx ON usage_events (actual_model, occurred_at);
```

A few notes:

- Preserve provider-native field meanings. Do not silently relabel Anthropic's `cache_creation_input_tokens` into some generic bucket without recording what you did.
- Keep a `raw_usage jsonb` or equivalent if you want to survive future provider field changes without losing evidence.
- `total_input_tokens` is easy to botch. If you derive it, compute it as the sum of the separately-stored categories only when those categories are actually reported as separate. Otherwise you can double-count. Store the raw shape too.
- Make ingestion idempotent with a stable request/idempotency identity, and deduplicate before counting.
- For higher volume, partition `usage_events` by time and build reporting aggregates from the raw events rather than querying the raw table for every dashboard.

---

## 12. Reporting query, as a reference

Per-key, per-day, per-model rollup:

```sql
SELECT
  api_key_id,
  date_trunc('day', occurred_at) AS day,
  actual_model,
  SUM(COALESCE(actual_input, 0))   AS input_tokens,
  SUM(COALESCE(actual_output, 0))  AS output_tokens,
  SUM(COALESCE(cached_input, 0))   AS cached_input_tokens,
  SUM(COALESCE(actual_cost_micro_usd, 0)) AS cost_micro_usd,
  COUNT(*) FILTER (WHERE status = 'success') AS successful_attempts
FROM usage_events
WHERE tenant_id = :authorized_tenant
  AND occurred_at >= :start_time
  AND occurred_at <  :end_time
GROUP BY api_key_id, day, actual_model
ORDER BY day, api_key_id, actual_model;
```

Serve this through a customer-authorized endpoint or dashboard. Enforce tenant access in the query — do not just trust a client-supplied key ID. Make it clear whether each number is actual, estimated, or still provisional.

---

## 13. Pre-flight vs post-hoc in practice

A clean request path looks like this:

1. Edge applies coarse IP flood control.
2. Proxy authenticates the key and loads tenant/user, scopes, status, and limits.
3. Resolve model and price schedule; reject unauthorized models/operations.
4. Estimate prompt tokens; compute maximum permitted exposure using the output cap.
5. Atomically check and reserve RPM, TPM, concurrency, and budget across the relevant scopes.
6. Call the provider; capture returned usage and model info, including for streaming.
7. Settle the reservation against actual usage; write an idempotent usage event; release the concurrency lease.

Keep the fast path and the financial source of truth separate. Redis-style shared counters are good for distributed rate/concurrency checks. Budget hard stops should live in a durable, transactionally updated store, not an eventually refreshed dashboard aggregate.

If the rate store is unavailable, decide explicitly per endpoint whether you fail open or fail closed, and alert on it.

---

## 14. Caching cost model, written out

For Sonnet 4 at the current general rates, before any partner or negotiated modifier:

```text
input_cost  = uncached_input_tokens × 3.00 / 1_000_000
write_cost  = cache_write_tokens    × cache_write_price / 1_000_000
read_cost   = cache_read_tokens     × 0.30 / 1_000_000
output_cost = output_tokens         × 15.00 / 1_000_000

total = input_cost + write_cost + read_cost + output_cost
```

Where `cache_write_price` depends on the cache TTL category if that is available: 1.25× for a 5-minute write, 2× for a 1-hour write, using the current model's pricing page as the source of truth. Newer tiers may use lower cache-read multipliers.

For accounting defensibility:

- Store the provider/model.
- Store the cache TTL category if available.
- Store all token categories separately.
- Store the price version/rate used.
- Periodically sample your gateway totals against the upstream bill for the exact model, cache TTL, and route.

---

## 15. What not to build naively

- **Do not trust client-supplied client IP for billing or quotas.** It is an abuse signal, not an identity.
- **Do not count only raw input tokens** when caching is in play.
- **Do not assume rate limits are spend limits.** They are not.
- **Do not buffer streamed responses just to read usage at the end.** Tee and parse incrementally instead.
- **Do not let the upstream URL be client-controllable.** That is an SSRF surface: an attacker can induce your server to reach internal services, loopback, or cloud metadata endpoints, and may capture forwarded credentials. Prefer an endpoint allowlist, constructed server-side, with HTTPS only, no automatic redirects, and outbound network controls as defense in depth.
- **Do not use a short prefix or label as authentication.** It is a display hint, not a credential.
- **Do not rely on per-instance counters alone** if you care about global limits across replicas, unless you accept that weakness explicitly.

---

## 16. Validation checklist before you declare this "done"

1. Key issuance returns a secret once, stores a verifier, and binds the key to tenant/user/scopes.
2. A key with a spend ceiling is actually rejected before the upstream call when the ceiling would be exceeded.
3. RPM, TPM, and concurrency limits are enforced per the scope you chose, and the behavior on store failure is explicit.
4. Streaming keeps latency low and still records final usage.
5. Cache tokens are stored separately and priced separately.
6. Client IP is trustworthy only because the edge strips/overwrites it; a direct forged header cannot bypass your IP limits.
7. Usage events are idempotent and append-only; estimates and actuals are both retained.
8. Per-key cost and token reports are served with tenant-scoped authorization.
9. The upstream URL/key are not client-controllable.
10. Spot-check gateway totals against the provider bill for the same model/route/cache behavior.

---

## 17. Suggested next artifact

The natural next deliverable is a scaffolded local stack you can run and then harden:

- Docker Compose: Postgres + LiteLLM + Caddy.
- A small key-issuance helper and a minimalist usage_events/reporting layer that imports from LiteLLM's standard logging payload or from the upstream response directly, depending on how much independence you want from LiteLLM internals.
- Caddyfile with correct trusted-proxy handling and `flush_interval -1`.
- A short hardening note covering fail-closed behavior, backups/retention, HTTPS DNS, and pinning images to versions/digests.

If you want, I can turn this blueprint into that scaffold and a runbook, with the live pricing page verified before any multiplier is hard-coded.

---

## Sources

- LiteLLM virtual keys and ownership/spend: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM budgets and rate limits: https://docs.litellm.ai/docs/proxy/users
- LiteLLM DB requirements and Compose quickstart: https://docs.litellm.ai/docs/proxy/docker_quick_start
- Current LiteLLM Compose file: https://github.com/BerriAI/litellm/blob/main/docker/docker-compose.quickstart.yml
- LiteLLM DB tables and spend logs: https://docs.litellm.ai/docs/proxy/db_info
- LiteLLM cost tracking: https://docs.litellm.ai/docs/proxy/cost_tracking
- LiteLLM logging payload, raw usage, and cache cost breakdown: https://docs.litellm.ai/docs/proxy/logging_spec
- LiteLLM prompt caching and token fields: https://docs.litellm.ai/docs/completion/prompt_caching
- LiteLLM production recommendations: https://docs.litellm.ai/docs/proxy/prod
- LiteLLM token usage and cost: https://docs.litellm.ai/docs/completion/token_usage
- LiteLLM OpenMeter callback integration: https://docs.litellm.ai/docs/observability/openmeter
- Anthropic streaming events: https://platform.claude.com/docs/en/build-with-claude/streaming
- Anthropic pricing and caching multipliers: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic Messages API create reference: https://platform.claude.com/docs/en/api/messages/create
- Anthropic Python SDK usage types: https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/usage.py
- Anthropic Claude 4 announcement: https://www.anthropic.com/news/claude-4
- Caddy reverse_proxy directive and streaming behavior: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy global server and trusted-proxy options: https://caddyserver.com/docs/caddyfile/options
- MDN X-Forwarded-For and parsing/trust guidance: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For
- Express running behind proxies: https://expressjs.com/en/5x/guide/behind-proxies/
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- Redis rate limiter: https://redis.io/docs/latest/develop/use-cases/rate-limiter/
- Moesif rate limits vs quotas: https://www.moesif.com/blog/technical/rate-limiting/Best-Practices-for-API-Rate-Limits-and-Quotas-With-Moesif-to-Avoid-Angry-Customers/
- OpenMeter usage deduplication: https://openmeter.io/blog/usage-deduplication
- Chroma usage-based billing engineering writeup: https://www.trychroma.com/engineering/billing
- OpenTelemetry GenAI attributes: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
- Portkey budget limits: https://portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits
- Portkey rate limits: https://portkey.ai/docs/product/ai-gateway/virtual-keys/rate-limits
