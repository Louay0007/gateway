# CPO Roadmap — Zaino

2026-11-06. Read: whole `portal/`, whole `gateway/` stack, live Postgres.

---

## The strategic fact that shapes every decision

Upstream is **$30 flat, unlimited**. Every competitor's COGS is per token.

That inverts the normal playbook: generosity is not a cost, it is a weapon.
We should give away more than anyone can profitably match, and make that
visible. Every feature below is chosen for one of two jobs:

- **let a developer be productive in 10 minutes**, or
- **let a company consolidate its whole AI spend on us**.

Nothing else. Features that only decorate the dashboard are cut.

---

## What we already have that is genuinely strong

Do not rebuild these — market them:

- OpenAI-compatible **and** Anthropic-compatible, natively (`config/litellm.yaml`,
  `edge/server.mjs`)
- Verified **Claude Code** and **Codex** configs that actually work
  (`portal/components/docs/docs-claude.tsx`, `docs-codex.tsx`) — this is our
  single best developer-acquisition asset and it is buried in `/docs`
- **`/v1/responses`** via the shim — most gateways do not have this
- 1M context, 65k output, 4 tiers, `zn-` keys
- Self-hosted **web search** (SearXNG) and a Rust **document-extraction engine**
- A working chat product with memories, projects, scheduled tasks, sharing

---

## P0 — Developer on-ramp (this sprint)

### 1. A config generator, not an SDK
A developer should never hand-write a base URL. One page: pick your tool
(Claude Code, Codex, Cursor, Vercel AI SDK, LangChain, LlamaIndex, Open WebUI,
n8n, Continue, Aider, Zed, plain curl), pick a tier, paste a `zn-` key, get a
copy-paste block that works.

The OpenAI and Anthropic SDKs already speak our API — shipping our own SDK
would be pure waste. The gap is **discovery**, not transport.

- Files: new `portal/app/(marketing)/connect/`, reuse `components/docs/code-block.tsx`
- **Done when:** a stranger goes from landing page to a 200 response without
  reading `/docs` and without asking a question.

### 2. Playground
Highest-intent page on any model API. Prompt box, streaming answer, live token
count, and the cost of that call. Tier picker, temperature, system prompt,
image attach.

Must run **through the real gateway with the user's own key** — no server-side
bypass, ever (audit constraint).

### 3. Programmatic quota for keys, not sessions
`/api/device/usage` (`portal/app/api/device/usage/route.ts`) already
authenticates by gateway key and returns per-alias budget — but it is named and
scoped for the desktop app. A developer cannot check their own quota from a
script.

Promote it to a stable public surface: `GET /api/v1/usage` and
`GET /api/v1/models`, key-authed, documented, versioned. This is a 30-minute
generalization of working code and it is the difference between "a chat app"
and "an API company".

### 4. Embeddings and rerank
`config/litellm.yaml` declares exactly four aliases, all
`supported_endpoints: ["/v1/chat/completions", "/v1/messages"]`. There is no
`/v1/embeddings`, no `/v1/rerank`.

Every RAG product needs both. Without them a company cannot consolidate on us —
they keep a second vendor for retrieval, and the second vendor is who they
renew with. Add `embed` and `rerank` aliases; price them in tokens like the rest.

### 5. Docs that answer the questions devs actually ask
Current `/docs` covers quickstart, models, OpenAI, Anthropic, Codex, Claude Code,
keys. Missing, all of them high-traffic:

- **Prompt caching** — our biggest real cost lever and a genuine selling point
  (`cache_read` rates are already configured). Show a before/after.
- **Tool calling / function calling** — the gateway supports it; nothing
  documents it.
- **Structured output** (`response_format`) — what is supported, what is not.
- **Streaming + SSE** — the edge streams correctly (tested in
  `portal/tests/auth-edge.test.mjs`); nobody knows.
- **Error codes** — 429 / 403 / out-of-tokens, and what each means per alias.

Also: `components/docs/docs-data.ts:7` still says *"INVARIANT: only the three
aliases"* while four exist. Fix the comment and the model table together.

---

## P1 — Company adoption (next 2–3 weeks)

Companies do not buy models, they buy **control**. In order of what unblocks a
procurement conversation:

### 6. Team UI
`organization_members` already has five roles — `owner, admin, developer,
billing, viewer` (`portal/db/migrations/0001_init.sql:53`). There is **no UI**
to invite anyone, and `api_keys` has no per-key model scope surfaced. Every
company asks "can my devs use Pro models but my analysts not?" — today the
answer is "buy a separate org".

Build: invite by email, role picker, per-key allowed-alias checkboxes.

### 7. Audit log
`audit_log` table exists with `org_time` and `action` indexes
(`0001_init.sql:258`). Nothing reads it. A read-only `/dashboard/audit` page
with filters is a half-day and it is a checkbox on every enterprise form.

### 8. SSO
The deleted `business` plan promised `sso: true`; nothing implements it. Add
OIDC (Google Workspace, Microsoft Entra, Okta). Companies with >10 devs will
not onboard individuals one by one.

### 9. Usage webhooks + CSV
`/api/usage/export` exists. Companies want it pushed, not pulled: a signed
webhook on budget thresholds and on period rollover. This is also how their
finance team reconciles us against every other vendor.

### 10. Invoices, not just receipts
`billing_events` records payments; there is no PDF invoice with our legal
details. A company's accountant cannot book an email confirmation. This is
frequently the last blocker before the first paid seat.

---

## P2 — Community and credibility (4–6 weeks)

### 11. Status page
`docker-compose.monitoring.yml` exists and Prometheus is not running. Publish
uptime for the gateway, edge, and engine. Developers check this before they
commit their architecture to you.

### 12. Changelog that is current
`components/marketing/changelog-content.tsx:95` still describes *"three models
behind our three aliases"*. We now have four tiers, and the entry is the
first thing a prospective dev reads. Make the changelog an RSS-feedable page
and ship an entry per release — our commit log is already good, it just never
reaches anyone.

### 13. Mobile app pointed at us
`mobile-app/zaino` is live on Play Store (`com.zainoai.app`) and App Store
(`id6749840287`) and contains **no reference to `zaino.soon.it`**. Add a
one-tap "Zaino" preset — base URL, `zn-` key, tier picker. Cheapest
acquisition loop we own and it is disconnected.

### 14. Community surface
A public Discord/forum link, and a documented way to report a bad response.
Devs who cannot reach a human churn silently.

---

## Deliberately cut

Not because they are bad, but because they do not move a developer or a
procurement decision this quarter:

- Our own SDK (OpenAI/Anthropic SDKs already work)
- Voice, image generation, canvas/artifacts
- i18n beyond FR/EN/AR, dark mode, mobile nav polish
- LiteLLM 1.103.1 → 1.108.1 (maintenance window, not a feature)
- A second model vendor for redundancy (one upstream, flat cost, no need)

---

## Fix this week, not a feature

Small contradictions that cost trust with exactly the audience we are courting:

- `portal/components/dashboard/paywall-state.tsx:42` — no fable feature key, so
  **Fable never appears on the paywall**; `DEFAULT_FEATURE_VALUES` shows
  80M/32M/210M/85M against a live 100M/day per alias
- `portal/components/dashboard/billing-view.tsx:56` — renders **upstream model
  names** to customers, violating the alias-only surface
- `billing-view.tsx:416` — "Campaign ends 31 October"
- `portal/components/marketing/mobile-section.tsx:49` — "coming soon to iOS and
  Android", both live
- `config/Caddyfile:2` — placeholder ACME email
- `docs/aipilot-upstream.md` §0 — claims 402/blocked as of 2026-10-21

---

## Constraints (non-negotiable)

- **Never weaken metering.** Any playground or test surface runs through the
  real gateway with the user's own key.
- **Alias-only surface.** No upstream model name in customer UI.
- **D17 receiver phone is secret.** Never client-side.
- **Staff/customer separation**; `light-surface` token scope unchanged.

---

## Sequencing

| Sprint | Ship | Unlocks |
|---|---|---|
| 1 | Config generator, playground, `/api/v1/usage` + `/api/v1/models`, docs gaps | A developer can onboard alone, in minutes |
| 2 | Embeddings + rerank, team UI, audit log | A company can consolidate and delegate |
| 3 | SSO, usage webhooks, PDF invoices | Procurement can say yes |
| 4 | Status page, live changelog, mobile preset, community | Compounding acquisition |
