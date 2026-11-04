# Handoff prompt — build the ChatGPT/Claude-style web product on `portal/`

Paste this document (or point me at it) as the opening brief. It is written to be executed top to bottom, not skimmed.

---

## 0. Read these first, in this order

1. `plans/web-chat-restructure.md` — 266 lines, the full target design. This is the **spec**. It is good and mostly correct; §5.4 below lists the places where it is factually wrong and must not be implemented as written.
2. `plans/revert-web-chat-restructure.md` — the revert you execute in Step 1.
3. `PORTAL_PRODUCT_AUDIT.md` — why the product is shaped this way (audit §1 on the paywall-first conversion gap, §10 on the playground).
4. `PLATFORM.md` §10.1 (the IDOR rule: every read filtered by org) and §3.3 (the margin maths on cost multiplier).

Do not start editing before you have read 1 and 2. Both exist; do not re-derive them.

---

## 1. What this repo is

A self-hosted, multi-tenant LLM gateway plus its customer portal.

- `portal/` — Next.js 16 (App Router), React 19, TypeScript 5.7, Drizzle ORM over Postgres, vitest. This is 95% of the work.
- `config/litellm.yaml` — LiteLLM config. Declares customer-facing **aliases** `fast | smart | frontier`. Customers never see upstream model names.
- `config/Caddyfile` — TLS edge + reverse proxies. Three vhosts; the portal vhost is the one you will touch.
- `edge/server.mjs` — rewrites customer keys `zn-…` → gateway keys `sk-…`. Exists so an unmetered path cannot exist.
- `docker-compose.yml` — portal runs in a container and reaches LiteLLM at `http://litellm:4000`.

Two invariants that outrank your feature work:

- **Never create an unmetered model path.** Every token must reach LiteLLM so it lands in the ledger. `edge/server.mjs` and the `verify-*` Make targets exist to keep this true.
- **Never render an upstream model name.** Only `fast | smart | frontier`. `lib/pricing/alias.ts` enforces it in the ledger; your UI must not leak `model` out of an upstream error body.

---

## 2. Current state — the tree is mid-revert

A previous session deleted the marketing site and the whole `/dashboard` to rebuild the portal as a chat product. That restructure was abandoned partway. **The deletions were never committed.**

Measured facts:

| Fact | Value |
|---|---|
| Unstaged deletions | 67 tracked files (`git status` shows ` D`) |
| Unstaged modifications | 16 (all of them dangling-`/dashboard` repairs made *for* the deletion) |
| Index vs `HEAD` | identical — `git diff --cached` is empty |
| Every deleted path in `HEAD`? | yes, verified for all 67 |
| Tracked changes total | 83 files, ~10,590 lines removed |
| Untracked entries | 18 — must be preserved (list in `plans/revert-web-chat-restructure.md` §2) |

So the practical consequence: **the codebase you are being asked to extend is the same codebase that already worked at commit `dcc30ac`.** Nothing needs reconstructing by hand; it needs restoring.

### Why the revert comes before any feature work

The previous attempt deleted first and rebuilt second, which left a tree that 404s everywhere and had to be rolled back. Do it the other way round: restore the working product, then **add** the chat surface alongside it. The dashboard already implements plans, usage, keys, billing and profile against live endpoints. You get all six settings surfaces for free, and `(app)` only becomes deletable once `/chat` + `/settings` genuinely cover it.

---

## 3. What I want built

The exact shape in `plans/web-chat-restructure.md` §1. Restated so there is no ambiguity:

```
/                     → redirect: /chat (signed in) | /sign-in (anonymous)
/sign-in, /sign-up    → existing, restyled into the new shell
/reset-password/**    → existing, unchanged
/verify-email/[token] → existing, unchanged

/chat                 → new chat; empty state, model picker, composer
/chat/[id]            → existing conversation
/settings?tab=…       → one page, six tabs:
                        profile | plan | usage | keys | billing | danger

/admin/**             → unchanged (separate vhost, staff gate)
/checkout/d17/[id]    → unchanged
/billing/confirm      → unchanged
/device               → unchanged
/privacy, /terms      → unchanged
```

Product behaviours that are decisions, not preferences:

- **A chat playground, not a marketing funnel.** The conversation owns the viewport. Settings is a pane, not a dashboard of cards.
- **Auth-first, never paywall-first.** A signed-in user with no subscription still reaches `/chat` with a live composer. The first send returns a real 402 that explains the plan and links to `/settings?tab=plan`. Landing a fresh signup on a billing page before they have seen the product is the #1 conversion gap named in `PORTAL_PRODUCT_AUDIT.md` §1 — a chat product makes it worse.
- **The "plans and usage" detail lives in `/settings?tab=plan` and `?tab=usage`.** Per-alias daily meters, real numbers, real reset time, CSV export. This is the half of the product that already has a working backend (§6).
- **The browser never holds a credential.** Model calls go through `POST /api/chat` on the server. The `zn-` dashboard key is a developer credential, not a session credential, and any page that renders model output is an XSS surface.

---

## 4. Non-negotiable rules

1. **Delete nothing.** Not a file, not a route, not a test, not a "dead" component. If something is in the way, move it (e.g. into `plans/attic/`) or leave it. This is a hard instruction from the user, given twice.
2. **Never `git add -A`, `git add .`, or `git commit -a`** in this repo. `mobile-app/` is 2.9 GB with its own nested `.git` (adding it creates a broken gitlink), and `.gitignore` only blocks root-level `*.png` via `/*.png` — so the 11 new Halloween assets under `portal/public/images/halloween/` are **not** ignored and a blanket add commits them by accident. Full preserve list: `plans/revert-web-chat-restructure.md` §2. Always name paths.
3. **Revert before you build.** Step 1 is the revert. Do not start a chat feature on top of a 404ing tree.
4. **Do not weaken metering, quota, or entitlement checks** to make a demo work. If your chat path can skip the ledger, it is wrong.
5. **Do not trust this document over the code.** Every claim here was verified at time of writing, and a few of them will rot. If the code disagrees, the code wins — and say so.
6. **Do not change the build script** to work around the `--webpack` requirement (§7).

---

## 5. Corrections — verified, do not rediscover

These are places where the spec is wrong, or where the obvious implementation is a trap. Each was checked against the code.

### 5.1 Never reuse `lib/litellm/client.ts` `call()` for inference

That helper hard-codes a 30-second abort:

```38:38:portal/lib/litellm/client.ts
      signal: AbortSignal.timeout(30_000),
```

Correct for management calls, fatal for a four-minute generation. `lib/chat/gateway.ts` needs its own `fetch` with **no** timeout and a raw `ReadableStream` pass-through.

### 5.2 Do not hardcode `127.0.0.1:4000`

The spec says call loopback. In Docker the portal reaches LiteLLM at `http://litellm:4000` — that is `docker-compose.yml:106`, and again at `:214`. Import the existing constant:

```14:14:portal/lib/litellm/endpoint.ts
export const LITELLM_BASE = process.env.LITELLM_INTERNAL_URL ?? 'http://127.0.0.1:4000';
```

A hardcoded loopback works locally and dies in production. Also note the spec's own reasoning holds — call `:4000` (LiteLLM), not `:4001` (the auth edge), because an internal caller already holds the `sk-` form.

### 5.3 There is no markdown renderer and no CSP

- `portal/package.json` has no markdown, sanitizer, or syntax-highlighting dependency. Rendering model output is a genuinely new dependency decision plus a new XSS surface.
- `next.config.ts` sets exactly three headers — `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. **There is no Content-Security-Policy**, despite the spec §8.6 saying to "re-check the existing CSP posture". There is none to re-check.

Requirements: sanitized markdown (no raw HTML), `rel="noopener noreferrer nofollow"` on links, and an actual CSP written before message rendering ships. This is net-new scope, not verification work.

### 5.4 A chat key in `api_keys` would consume a customer slot

`api_keys.kind` exists and defaults to `'personal'`:

```245:245:portal/db/schema.ts
  kind:           text('kind').notNull().default('personal'),
```

But the ceiling check ignores it entirely:

```195:203:portal/lib/keys/store.ts
  async countActiveKeys(organizationId): Promise<number> {
    // Counted in SQL: revoking a key frees a slot immediately, so the
    // ceiling must be evaluated against unrevoked rows, not all rows.
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS n
        FROM api_keys
       WHERE organization_id = ${organizationId}::uuid
         AND revoked_at IS NULL
```

Starter allows 3 keys. An org chat key inserted as a normal row silently eats one, and the keys tab then behaves like a UI bug. **Do not reuse `createApiKey`** — it also enforces role and `maxKeys`, both wrong for a chat credential. Issue the chat key through a separate narrow function, and/or exclude `kind='chat'` from the count. Prefer both.

### 5.5 There is no symmetric crypto helper

`lib/crypto/` does not exist. `lib/auth/password.ts` is scrypt (one-way), `lib/auth/device/policy.ts` is HMAC (one-way). The chat key needs **reversible** storage on every request, so add `lib/crypto/sealed.ts`: AES-256-GCM, random 12-byte IV per record, `v1:` envelope prefix. Key from a **new `CHAT_KEY_SECRET`** env var — it does not exist anywhere in the repo today. Do not derive it from `AUTH_SECRET`; rotating a session secret must not 401 every live conversation.

### 5.6 Caddy will cut the stream

Portal vhost, `config/Caddyfile` — the transport block sits at ~line 167 with `response_header_timeout 60s` / `read_timeout 120s` / `write_timeout 120s` at lines 169–171, under a comment that literally says "never on a model generation". `flush_interval -1` is already present for the Stripe webhook, so SSE will flush; it is the timeouts that truncate. Separately, `request_body max_size 2MB` (line 135) will 413 a long paste.

Needed: a `route /api/chat*` block ahead of the `reverse_proxy 127.0.0.1:3000`, with `flush_interval -1`, `response_header_timeout 300s`, `read_timeout 900s`, `write_timeout 900s`, and a 10MB body cap. Nothing else on the vhost may get looser. `make verify-caddy` is the gate.

### 5.7 The Halloween promo has already expired

`lib/billing/promo.ts` windows `2026-10-25T00:00+01:00 → 2026-11-01T00:00+01:00`. Today is 1 November 2026, so it is over. The restored `/pricing` and pricing component will show list prices, correctly, with no discount chip. Do not "fix" that. Note that the restored landing page still carries a Halloween skin (forced dark, decorations, "Halloween Edition" title) — stripping it is a small separate task, not part of this work, and not a reason to touch the landing page.

### 5.8 The test baseline is not green

Verified by running the suite: **364 passed, 2 failed**. The two failures are pre-existing and unrelated — `tests/reset.test.ts` and `tests/verify-email.test.ts`. Do not treat them as your regression, and do not "fix" them unless asked. Any *third* failure is yours.

---

## 6. Build order

Each step ends buildable. Do not start a step before the previous gate passes. Step 1 is the revert; steps 2–5 are the product.

### Step 1 — Revert

Follow `plans/revert-web-chat-restructure.md` exactly. Summary of the order that matters:

1. Optionally snapshot the deletion state on a scratch branch using `git add -u` (tracked paths only — never `-A`), so the restructure stays reproducible.
2. **Park the interim root page first:** move `portal/app/page.tsx` to `plans/attic/app-root-page.interim.tsx`. It is untracked and new, and it collides with the restored `portal/app/(marketing)/page.tsx` — both resolve to `/`, and Next fails the build on duplicate routes. Move it, do not delete it.
3. Restore: `git restore --source=HEAD --worktree -- portal/ config/litellm.yaml`
4. Gate: `cd portal && npx tsc --noEmit` → 0. Then `npx next build --webpack` → success, with `/`, `/pricing`, `/docs`, `/changelog`, `/download`, and `/dashboard/*` all in the route table.
5. `git status --short` must show **zero** ` D` and **zero** ` M`, and the untracked set from `plans/revert-web-chat-restructure.md` §2 must be intact.

### Step 2 — Chat shell, no network

New route group `app/(chat)/` with its own layout, so the conversation owns the viewport and `/settings` scrolls independently.

Copy the guard from the restored `(app)/layout.tsx` **verbatim in behaviour**, because each piece is load-bearing:

```53:74:portal/app/(app)/layout.tsx
  const isStaff = (await currentStaffRole()) !== null;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  await ensureSessionReady(user.id);
  const verified = await isEmailVerified(user.id);
```

- `currentUser()` → `redirect('/sign-in')`: without it an anonymous request renders the full shell and every client fetch 401s into a permanent "Loading…".
- `ensureSessionReady(user.id)` (from `lib/auth/provision.ts`): provisions the personal org on first authenticated render. Skipping it races the parallel `/api/orgs` + `/api/subscription` reads into two orgs.
- `isEmailVerified` + the `ResendVerification` banner: an unverified account can browse but cannot create keys or subscribe. Drop the banner and the verification gate becomes invisible.

Then a static `/chat`: sidebar, composer, model picker reading `getAllowedModels`. No network. Plus `/` → redirect and the `/settings` shell with all six tabs wired to the **existing** endpoints (§6 table above). Ship this before touching streaming — it is the highest-value, lowest-risk step and it makes the product feel real.

**Gate:** signed-in user reaches `/chat`; all six settings tabs render real data; anonymous `/chat` redirects to `/sign-in`.

### Step 3 — Migration `0026` + the sealed secret

`conversations`, `messages`, `chat_credentials`, plus `usage_records.gateway_request_id text` + index (schema in spec §3, corrections in §5.4/§5.5 above). Add `CHAT_KEY_SECRET` to `.env.example` and `docker-compose.yml`.

**Gate:** migration applies forward on a copy of the DB; chat key created once per org; decrypt round-trip unit-tested.

### Step 4 — `POST /api/chat` streaming

The only genuinely new backend path. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, return a `ReadableStream` over the upstream body, `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`. No `Content-Length`, no buffering, no `await res.text()` anywhere on the path. Client uses `fetch` + a stream reader, not `EventSource` (it cannot POST), with an `AbortController` that still persists the partial message.

Validate: session, org, `alias ∈ getAllowedModels().allowed`, message non-empty and under a byte cap, conversation ownership. Abort upstream on client disconnect so a closed tab stops billing.

**Gate:** a streamed answer renders token-by-token through the **real Caddy vhost**, not just `localhost:3000`.

### Step 5 — Caddy

Per §5.6.

**Gate:** a 4-minute stream survives; a 3MB paste is accepted; `make verify-caddy` green; nothing else on the portal got looser.

### Step 6 — History, cost attribution, quota UX

`/chat/[id]`, rename/delete/regenerate/stop, partial-abort honesty. `collect_usage` persists `request_id` (it already reads it for `dedupeHash` — `lib/jobs/collect-usage.ts:32-37`), the message row joins on it, so "this answer cost 3.2¢ / 41k tokens" is a fact and not an estimate. Then the pre-send quota wall from `getAllowedModels`: show `fast: 100M / 100M used today — resets 00:00 Tunis` and disable the alias, rather than letting the user compose a message that 403s.

Note the two-clocks trap: `subscriptions.daily_quota` is `FALSE` for grandfathered paid rows, so the same meter covers a Tunis day for new users and a subscription period for older ones. **Label from `bundle.period.start/end`, never a hardcoded "today".**

**Gate:** `make verify-metering` green; a chat turn appears in `usage_records` with a matching id; exhausting a seeded alias disables it in the picker *and* the server refuses it.

### Step 7 — Polish

Keyboard map, focus management, `aria-live="polite"` for streaming, empty/error/offline states, both themes, and the sanitizer + CSP from §5.3.

**Gate:** `npx vitest run` shows exactly the 2 pre-existing failures and no more; `make verify-metering`, `verify-d17`, `verify-grant`, `verify-caddy` all green; Lighthouse a11y pass on `/chat` and `/settings`.

---

## 7. Where things live

**Reuse, do not rewrite:**

| Path | Why |
|---|---|
| `lib/api/use-api.ts` — `useApi<T>(path)` | error-envelope unwrap, refresh-without-blank, unmount-safe |
| `lib/dashboard/format.ts` | `centsDt`, `compact`, `usdToTnd` — also used by admin, keep it put |
| `lib/entitlements/allowed-models.ts` — `getAllowedModels(orgId)` | the one quota wall; never compute a second |
| `lib/billing/state.ts` — `PlanSummary` / `PlanState` | the shape the plan tab renders |
| `components/ui/*`, `components/auth/*` | incl. `password-checklist.tsx` |
| `lib/i18n/d17.ts` | `fr`/`ar`/`en` + RTL — the D17 transfer flow is trilingual, so don't hardcode LTR copy into it |

**The settings backend already exists.** All of `GET /api/subscription`, `GET /api/plans`, `POST /api/trial/redeem`, `GET /api/usage/summary?bucket=day`, `/api/usage/export`, `GET|POST /api/keys`, `DELETE /api/keys/[id]`, `GET /api/billing/payments`, `GET /api/profile`, `POST /api/profile/password`, `POST /api/account/delete`, `/api/subscription/{cancel,resume,change-plan}`. `subscriptionBundle` returns `plan`, `period`, `tokensByModel`, `exhaustedByModel`, `limits`, `keys: {active, max}`, `d17PaymentStatus`. The settings surface is **wiring, not backend work** — which is why it is Step 2 and not Step 6.

**New modules** (each small, single-purpose): `lib/chat/{service,title,gateway,key,quotas}.ts`, `lib/crypto/sealed.ts`, `app/api/chat/**`, `components/chat/*`, `components/settings/*`.

**Commands.** `next build` requires `--webpack` on this machine (missing Turbopack native binding). CI does not use that path. Do not edit the build script to work around it.

---

## 8. Open questions — ask before assuming

These are genuine product/security decisions in the spec §9. Default answers are given; confirm or override, and if you cannot get an answer, take the default and say you did.

1. **`CHAT_KEY_SECRET`** — new env var (default, recommended) vs derived from `AUTH_SECRET` (rejected: rotation couples sessions to conversations).
2. **One chat key per org** (default) vs per user. Per-org is recommended; per-user multiplies key churn for no UI benefit.
3. **Transcript retention** — `plans.features.history_days` exists (90/365) and is unenforced. Enforce it, or keep until deleted? Affects the ledger join in Step 6.
4. **OAuth** — schema is ready (`auth_accounts`), only Credentials is wired. Adding Google/GitHub is a separate contained phase and **not** required for "auth then chat".
5. **Public `/pricing` and `/docs`** — currently restored and live. If acquisition needs a public pricing page, design it into the shell rather than bolting it on later.
6. **"Playground" scope** — is `/chat` itself the playground (default), or do you additionally want the developer sandbox that `PORTAL_PRODUCT_AUDIT.md` §10 recommends (raw request/response, key selection, inside the keys area)? They are different surfaces with different audiences; the sandbox is a separate phase.
7. **`organizations.byok_ciphertext`** is declared in `db/schema.ts` with no writer anywhere. It is dead weight on every read, and `chat_credentials.key_ciphertext` is the first real user of that pattern. Drop it in `0026`, or leave for a future BYOK feature?

---

## 9. Definition of done

- `git status --short` shows only intentional, path-named changes; the 18 untracked entries are intact; `mobile-app/` is untouched.
- A new user can sign up, land on `/chat` (not a paywall), discover the plan wall from a real 402, and reach `/settings?tab=plan` in one click.
- `/settings` renders live data on all six tabs, with correct day-vs-period wording derived from `period.start/end`.
- A streamed answer completes through the production Caddy vhost in under 4 minutes without truncation, and a closed tab aborts upstream billing.
- Every chat turn appears in `usage_records` with a matching `gateway_request_id`, at the alias level, with no upstream model name anywhere in the UI.
- `npx tsc --noEmit` clean; `npx vitest run` = 364 passed / 2 pre-existing failures; `make verify-metering`, `verify-d17`, `verify-grant`, `verify-caddy` green.
- Nothing was deleted.
