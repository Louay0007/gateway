# Routing map

**Authoritative as of 2026-11-14.** If a route is not on this page it should
not exist; if it exists and is not here, add it here in the same change.

## The six surfaces

A URL's shape tells you which surface it belongs to, and every surface has
exactly one canonical prefix. This is the rule the audit enforced.

| Surface | URL shape | Chrome | Who reaches it |
|---|---|---|---|
| **Public** | flat, no prefix | `SiteNav` + `ZainoFooter` | anyone, no session |
| **Auth** | flat, no prefix | own minimal shell | anyone |
| **Product** | `/chat`, `/chat/[id]` | chat shell | signed in |
| **Console** | `/dashboard/…` | console sidebar | signed in |
| **Staff** | `/admin/…` | admin sidebar + gate | staff session |
| **Handoff** | flat, opaque token | own page | a device, an email, a receipt |

A route may not belong to two surfaces. That was the bug: `/settings` and
`/dashboard/settings` both rendered the same panel, and the `shell` prop
existed only to change one footer link.

---

## Public

| Route | Page | Notes |
|---|---|---|
| `/` | landing | hero, pricing preview, FAQ, changelog teaser |
| `/pricing` | plan comparison | two cards, grouped table, rates, 9-question FAQ |
| `/models` | catalog | per-alias rates + measured 7-day volume |
| `/playground` | try-it | runs on the visitor's own `zn-` key |
| `/connect` | config generator | 14 tools, snippet ends in a proving curl |
| `/docs` | integration guide | 7 sections, in-page TOC |
| `/changelog` | release notes | `/changelog.xml` is the RSS feed |
| `/download` | desktop app | install steps per platform |
| `/faq` | FAQ | reuses the landing `FaqSection` |
| `/contact` | contact | email / WhatsApp / phone |
| `/status` | live probes | latency medians, 8 checks per component |
| `/privacy`, `/terms` | legal | `light-surface` scope |

## Auth

| Route | Notes |
|---|---|
| `/sign-in`, `/sign-up` | credentials |
| `/reset-password` | request |
| `/reset-password/[token]` | complete |
| `/verify-email/[token]` | confirm |

## Product — `/chat`

`/chat` and `/chat/[id]`. The chat shell has its own sidebar and header. Its
navigation points at `/dashboard/settings` and `/dashboard/keys`, never at
the retired `/settings`.

## Console — `/dashboard`

| Route | Page |
|---|---|
| `/dashboard` | overview + "get to your first 200" checklist |
| `/dashboard/usage` | ledger, chart, export |
| `/dashboard/keys` | keys |
| `/dashboard/billing` | plan, payment, comparison |
| `/dashboard/settings` | **3 tabs: profile, AI, danger** — account-level only. `?tab=plan|usage|keys|billing` forwards to the page that owns it |
| `/dashboard/redeem` | trial code — a one-time action, so it sits under Account in the sidebar |
| `/dashboard/docs` | the integration guide inside the product, CTA → keys |

**Why `/dashboard/docs` is not a duplicate of `/docs`:** same body, different
intent. Public docs sell; the in-product copy points at the keys page and
assumes a session. It is the only intentional repeat in the tree.

## Staff — `/admin`

`/admin` (access-code gate) → `/admin/{ops,orgs,orgs/[id],d17,usage,credits,audit,plans,staff}`.
Gate cookie is pre-auth only; every page and route re-checks a staff row.

## Handoff — reached by something other than an internal link

| Route | Reached by |
|---|---|
| `/device` | the desktop app opens `verification_url` in the system browser |
| `/share/[token]` | a shared transcript link |
| `/billing/confirm` | the dev-payment provider's return URL |
| `/checkout/d17/[subscriptionId]` | the D17 checkout redirect |

These correctly have no inbound link from the product, and that is not a dead
route. A reachability audit must whitelist them.

## Redirects

| From | To | Why |
|---|---|---|
| `/settings` | `/dashboard/settings` (query preserved) | the chat shell's old settings URL. Kept so existing bookmarks land on the right tab instead of a 404. **Lives in `next.config.ts redirects()`, not a page** — a page-level `redirect()` in a streamed server component answers 200 with a client-side meta tag, which a curl or crawler never follows. |

One redirect only. A redirect table that grows is a sign the canonical route
moved without the old one being retired.

## Deliberately absent

- `/blog` — RSS on `/changelog` covers it (Phase 8 decision).
- `/about`, `/careers`, `/press` — no content to publish yet; the footer no
  longer links them rather than shipping a 404 the copy promises.
- A second marketing footer — one map, one place for a link to rot.

---

## Rules this file is enforcing

1. **One surface per URL prefix.** A new page picks a surface before it picks
   a path.
2. **No route renders under two shells.** If two shells need the same body,
   the body is a component and one of them redirects.
3. **A removed route gets a redirect, not a deletion,** when it has ever been
   linked. `/settings` was in the chat sidebar for months.
4. **Marketing pages do not live in product navigation.** Download left the
   console sidebar for the footer.
5. **Every prefix appears in exactly one nav**, so no page is discoverable
   only by typing its URL.
6. **Handoff routes are whitelisted in the audit**, not deleted, because the
   absence of an internal link is their design.
7. **A page with a sidebar destination does not also get a settings tab.**
   Settings owns account-level things only; if it has its own page, render it
   there and forward any old tab link.
