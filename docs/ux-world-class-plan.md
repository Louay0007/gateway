# Zaino — world-class UX, IA and design plan

**Written:** 2026-11-13
**Method:** read every route and component in `portal/app` + `portal/components`
(36 pages, 67 API routes, 167 tsx files, 35 UI primitives), then read the public
web surfaces of Cursor, Claude, ChatGPT, opencode and OpenRouter. Nothing here
is guesswork about our own code; competitor claims cite what was actually on
the page, and where a page could not be read it says so.

---

## 0. The one-sentence verdict

We have a **more complete product** than our web surface admits: real metering,
real quotas, real billing rails, a real admin console — presented through a
marketing site that hides pricing, has no way to get a key, and ships no error
states. The gap is not features. It is **the path from "a stranger found us" to
"a 200 response"**, and the visual system underneath it.

---

## 1. What the competitors actually do (measured, not remembered)

| Product | Hero | Primary CTA | Pricing unit | Console |
|---|---|---|---|---|
| Cursor | "your coding agent for building ambitious software" | **Download** (no account) | multipliers — 4× / 15× / 50× Plus | `/dashboard`, one click from download |
| Claude | "Question what's next" | Try Claude (plan preselected) | multipliers + time windows; **$/MTok table underneath** | `claude.ai` vs `platform.claude.com`, one "Start building" link |
| ChatGPT | *the composer is the landing page* | type a prompt | adjectives ("Unlimited text chats") | app-first |
| opencode | "The open source AI coding agent" | **Read docs** | free + $10 Zen tier | docs → `/connect` → `/models` |
| OpenRouter | — | — | **% fee on credits**, not a subscription | live 7-day token volume per model card |

**Could not read:** `platform.openai.com/docs`, `status.cursor.com`,
`claude.ai` (geo-blocked — itself a useful data point for a Tunisian audience).

### The 12 patterns they share

1. **Hero names the category in one sentence**, no slogan, no adjective.
2. **The primary CTA is the install/key path, never "book a demo".**
3. **Price the resource, not the model name.** No competitor publishes
   per-model request counts — they publish multipliers of one plan.
4. **Every tier is a multiplier of the entry paid plan** (4×/15×/50×).
5. **Each plan card says who it is for** in one line.
6. **Comparison tables are grouped by job** (Usage / Product / Team / Payment),
   sticky header, check-or-dash cells.
7. **A 9-question FAQ under pricing**, answers 1–3 sentences, including
   "which plan is right for me" with a named persona.
8. **Token rates in the smallest honest unit**, input / output / cache-read /
   cache-write on separate rows; discounts as one line.
9. **The trust question is answered in the negative**: "Do you mark up
   provider pricing? No." / "Are failed requests billed? No."
10. **Quickstart opens with a 3-row self-selection table** (raw API / SDK /
    agent) so nobody reads the wrong path.
11. **Auth choice is tabbed, not branched in prose.**
12. **A copy-paste config block with `$schema` for editor autocomplete** —
    opencode ships exactly this for OpenAI-compatible gateways, which is
    literally our integration surface.

Plus two nav-level proofs we have neither of: a **dated changelog block on the
homepage** and **off-site status with 90-day history**.

---

## 2. Where Zaino stands — the audit

### 2.1 Routes we have (36 pages)

**Marketing:** `/` · `/pricing` · `/docs` · `/changelog` · `/download` ·
`/terms` · `/privacy`
**Auth:** `/sign-in` · `/sign-up` · `/reset-password` · `/verify-email`
**App shell:** `/chat` · `/dashboard` · `/dashboard/{usage,keys,billing,settings,redeem,docs}`
**Admin:** `/admin` · `/admin/{ops,orgs,usage,staff,audit,plans,credits,d17}`
**Other:** `/checkout` · `/billing` · `/device` · `/share`

### 2.2 Routes that do not exist — and should

| Missing | Why it is the highest-value thing we can build |
|---|---|
| **`/connect`** | `CPO_ROADMAP.md` P0, still absent months later. A developer lands, has a key, does not know the three lines for Claude Code / Codex / Cursor / LangChain, and leaves. This is **the** conversion page. |
| **`/playground`** | The highest-intent page on any model API. Must run through the real gateway with the user's own key (metering invariant). We have a chat product that already does this — it needs a public, no-signup entry. |
| **`/models`** | Competitors give each model a card with live 7-day token volume, context, $/M in and out, one-click copy of the alias. We have the data (`usage_records`) and show it to nobody. |
| **`/status`** | Developers check uptime before committing architecture to you. `docker-compose.monitoring.yml` exists; Prometheus is not running. |
| **`/blog` or RSS on `/changelog`** | Build-in-public has no public record; the changelog is a static component, not a feed. |
| **`/faq`, `/about`, `/contact`** | `/faq` and `/contact` already 404 in production while the marketing copy references them. |

### 2.3 Trust bugs — things that are *wrong*, not missing

Each of these costs a sale at the exact moment a technical buyer is checking:

1. **`/docs` says smart is "Pro" only; Starter includes it.** Verified against
   the live DB: `starter = {fast, smart}`. `docs-data.ts` lists
   `smart: plans: "Pro"`. A developer reads the docs, then `GET /v1/models`
   disagrees.
2. **`docs-data.ts:7` still says "INVARIANT: only the three aliases"** while
   four exist and `fable` renders below it.
3. **Pricing is not in the navbar.** Nav is Download / Docs / Changelog / Sign
   in. The footer links `/#pricing`, a section anchor, not `/pricing`.
4. **`/pricing` renders a "This page could not be found" payload** inside its
   RSC tree while still answering 200 — the page is visibly half-broken to
   anything reading the DOM.
5. **Zero `error.tsx`, `not-found.tsx` or `loading.tsx`** across 36 pages. A
   thrown error in any route renders Next's bare default; a 404 is unstyled.
   Competitors treat these as product surface.
6. **`/dashboard` shows only two stat cards** — tokens used, tokens remaining.
   No recent activity, no key state, no "your first 200 response" next step.

### 2.4 Design-system debt (measured)

| Signal | Count | Read |
|---|---|---|
| Semantic token usages (`bg-muted`, `text-primary`, …) | **742** | The token layer exists and is the majority — good foundation. |
| Hard-coded palette classes (`bg-emerald-600`, `text-amber-400`, …) | **~150** | Two systems in one product. Emerald/amber/orange are doing the work `--success` / `--warning` should do. |
| `dark:` variants written by hand | **459** | Every one is a place the token layer was bypassed. |
| `.tsx` files containing `gray-NNN` | **36 of 167** | 21% of components opt out of theming. |
| `aria-*` attributes | 297 | Accessibility is present, not systematic. |
| Raw `<button>` outside `components/ui` | 8 files | Including `prompt-input.tsx` (3) and `chat-sidebar.tsx` (3) — the most-used surfaces. |

**The fix is not "use Tailwind less".** It is: add `--success`, `--warning`,
`--info` tokens; move emerald/amber/orange onto them; and let the 459 `dark:`
variants shrink to near zero because tokens already flip.

### 2.5 Architecture observations

- **Routes are grouped but chrome is per-page.** `(marketing)/layout.tsx` is a
  passthrough, so all 7 marketing pages mount `SiteNav` and a footer
  individually. One layout would remove the drift risk that already produced
  two footers (`footer.tsx` and `zaino-footer.tsx`) with **different Pricing
  targets**.
- **35 UI primitives for 167 components** is a healthy ratio; the problem is
  the 8 raw buttons and the two footer implementations, i.e. a few places that
  bypass it.
- **67 API routes vs 36 pages.** The machine surface is nearly twice the human
  surface — which is correct for an API company, and argues that `/connect`,
  `/playground` and `/models` should be the next three pages, not more
  dashboard tabs.

---

## 3. The plan

Ordered so each phase is shippable on its own, and so the cheapest conversion
wins come first. Effort is in engineer-days, assuming one person.

### Phase 0 — Trust sweep (1–2 days, do first, no design work)

Nothing here is new surface. All of it is a technical buyer catching us in a
contradiction.

- [ ] **Fix `docs-data.ts` model→plan mapping** against the live DB
      (`starter: fast, smart`; `pro: smart, frontier, fable`), and correct the
      "three aliases" invariant comment.
- [ ] **Add `/pricing` to the navbar**; point both footers at `/pricing` and
      delete the weaker of the two footer components.
- [ ] **Fix the `/pricing` RSC "page could not be found" payload.**
- [ ] **Add `error.tsx`, `not-found.tsx`, `loading.tsx`** at `app/` and
      `app/(app)/` — four files, one shared `ErrorState`.
- [ ] **`/faq` and `/contact`**: either build the two pages or remove every
      reference from marketing copy. A 404 the copy promises is worse than no
      copy.
- [ ] **`docs/aipilot-upstream.md:10`** — remove the expired key from a
      tracked file.

### Phase 1 — `/connect`: the conversion page (4–5 days)

The single highest-leverage page in the repo. `CPO_ROADMAP.md` calls it P0 and
it has been P0 for weeks.

**Shape** (mirrors what Cursor and opencode proved):

```
┌ Step 1 ─ Pick your tool ────────────────────────────────┐
│ Claude Code · Codex · Cursor · Zed · Continue · Aider   │
│ OpenAI SDK (py/js) · Anthropic SDK · LangChain ·        │
│ LlamaIndex · n8n · Open WebUI · plain curl              │
├ Step 2 ─ Pick a tier ───────────────────────────────────┤
│ Fast · Smart · Frontier · Fable  (shows the pool note)  │
├ Step 3 ─ Paste your key ────────────────────────────────┤
│ zn-…  (or "create one" if signed in)                    │
└─────────────────────────────────────────────────────────┘
   ↓ one copy-paste block, verified against the real gateway
```

Requirements:
- Snippets are **generated from the same source as `/docs`**
  (`components/docs/docs-data.ts`), never hand-written twice.
- Each block ends with a **"Test it" curl that proves a 200**, exactly the
  opencode pattern.
- Reuse `components/docs/code-block.tsx`.
- The auth choice is a **tab**, not branched prose (pattern 11).

### Phase 2 — `/playground` (4–6 days)

Prompt box, streaming answer, live token count, cost of that call, tier picker,
temperature, system prompt, image attach.

**Hard constraint:** it must run through the real gateway with the user's own
key — no server-side bypass, ever. This is the metering invariant and it is
also the honest demo: a customer watching their own pool tick down is the
product working.

Reuse: `/api/chat` already streams SSE and meters. The playground is a thin
public shell over it with a "bring your own key" gate.

### Phase 3 — `/models` catalog (2–3 days)

One card per alias:
`[alias] [context] [$in/M] [$out/M] [7-day tokens served] [copy slug]`

- 7-day volume is a single `usage_records` grouped query (we already run these
  in `collect-usage`).
- **Alias-only.** No upstream name, ever — the invariant that makes an
  engine swap a config change.
- This page replaces the awkward per-tier `poweredBy: "Zaino Haiku 5.5"`
  strings in `docs-data.ts` with something honest: the alias, its price, its
  usage.

### Phase 4 — Design system consolidation (5–7 days)

1. **Add semantic tokens** to `app/globals.css`:
   `--success`, `--success-foreground`, `--warning`, `--warning-foreground`,
   `--info`, plus dark-mode values.
2. **Migrate the ~150 palette classes** onto them (emerald→success,
   amber/orange→warning).
3. **Delete `dark:` variants** that a token now handles. Target: under 100
   remaining, all of them structural rather than colour.
4. **Delete the weaker footer**; one footer component, one link map.
5. **Replace the 8 raw `<button>`** with `Button` variants, or add a variant
   where the design genuinely differs.
6. **One `EmptyState`** used by every list (admin already has a good one in
   `components/admin/stat-card.tsx` — promote it).
7. **One `PageHeader`** pattern; today every page composes its own.

Acceptance: `rg "gray-[0-9]{3}"` returns zero; `rg "dark:"` under 100;
`rg "<button" components app --glob '!components/ui/**'` returns zero.

### Phase 5 — Dashboard becomes an onboarding surface (3–4 days)

A new customer's `/dashboard` today is two stat cards. Competitors make the
first run a checklist.

```
┌ Get to your first 200 ──────────────── 2 of 4 ┐
│ ✅ Account created                             │
│ ✅ Trial active — 1M tokens, resets Dec 15     │
│ ⬜ Create an API key            [Create key]   │
│ ⬜ Send your first request      [Open /connect]│
└────────────────────────────────────────────────┘
   ↓ then, and only then, the usage cards
```

- The checklist is state-driven, not a dismissible banner.
- **"First 200 response" is the only activation metric that matters** —
  it should be visible on `/dashboard` and in `/admin/usage`.

### Phase 6 — Status and changelog as product (2–3 days)

- **`/status`**: start Prometheus (`docker-compose.monitoring.yml` already
  exists, is not running). Publish gateway, edge and engine uptime with 90-day
  history — competitors all host this off-site.
- **`/changelog` becomes a feed**: entries as data, RSS at `/changelog.xml`,
  and a 4-entry block on the homepage (pattern 15). Our commit log is already
  good; it reaches nobody.

### Phase 7 — Pricing page rebuild (2 days, after Phase 0)

Current page has the right numbers and no structure. Rebuild to the pattern:

- Three columns max, each with a **one-line "who it's for"**.
- **Multiplier framing**: Starter = 1×, Pro emphasises model class rather than
  volume (both are 50M — be explicit rather than silent).
- Comparison table grouped **Usage / Models / Team / Payment**, sticky header.
- **The aggregator trust FAQ, in the negative**:
  "Do you mark up token prices?" → No, the rate is the rate.
  "Are failed requests billed?" → No.
  "What happens at the 50M ceiling?" → All models pause until renewal.
- **$/MTok table** with input / output / cache-read on separate rows.

### Phase 8 — Explicitly NOT doing

Removing work is part of a plan:

- **No own SDK.** OpenAI and Anthropic SDKs already speak our API. Shipping
  one would be pure waste and contradicts `/connect`.
- **No dark/light toggle redesign, no i18n beyond FR/EN/AR.** Already decided
  in `CPO_ROADMAP.md`; still right.
- **No blog engine.** RSS on the existing changelog gets 90% of the value for
  5% of the work.
- **No separate `app.zaino.soon.it` host.** Claude splits app from console
  because it has two products; we have one app shell and one console already
  separated by `/admin`. Splitting hosts now would be churn.
- **No 3D/marketing animation work** until Phases 0–3 are shipped.

---

## 4. Sequencing

| Phase | Ship | Unlocks | Days |
|---|---|---|---|
| 0 | Trust sweep | Nothing embarrassing on the way to the money | 1–2 |
| 1 | `/connect` | A developer onboards alone, in minutes | 4–5 |
| 2 | `/playground` | Try before signup; the meter is the demo | 4–6 |
| 3 | `/models` | Credibility through usage, not claims | 2–3 |
| 4 | Design system | Every future page is cheaper and consistent | 5–7 |
| 5 | Dashboard onboarding | Signup → first 200 becomes measurable | 3–4 |
| 6 | Status + feed | Compounding trust | 2–3 |
| 7 | Pricing rebuild | The final comparison before payment | 2 |

**Phases 0–2 are the launch blocker for the LinkedIn campaign.** That campaign
sends traffic to `/pricing` and `/docs`, and today neither leads anywhere a
stranger can finish.

---

## 5. Verification

Every phase, per repo convention:

```bash
cd portal && npx tsc --noEmit
cd portal && npx vitest run
```

Plus, for the UI phases, real browser checks against the local dev server
(`npm run dev`) and then the live box:

```bash
cd portal && npm run dev
```

Specifically:
- **Phase 0:** `/pricing` renders without the not-found payload;
  `curl -o /dev/null -w '%{http_code}' /faq` matches the decision (built or
  removed from copy); every route's 404 is styled.
- **Phase 1:** pick three tools in `/connect`, copy each block verbatim into a
  shell, and confirm **200** with a real `zn-` key. A snippet that does not
  execute is a bug, not a typo.
- **Phase 2:** the playground request appears in `usage_records` with a
  non-zero `cost_customer_usd` — proof it went through the meter.
- **Phase 4:** the three `rg` acceptance checks in §3 Phase 4 return their
  targets.
- **Phase 5:** a brand-new account shows the checklist; completing it flips to
  the usage view.

---

## 6. The bet

Competitors compete on model quality, which we do not control. We control three
things they do not: **a flat upstream cost**, **a metered gateway we can prove**,
and **prices in dinars for a market everyone else geo-blocks**. The UX plan above
spends nothing on looking like Cursor and everything on making our one
structural advantage legible in the first sixty seconds: one key, two wire
formats, one pool of 50M, a meter you can audit.
