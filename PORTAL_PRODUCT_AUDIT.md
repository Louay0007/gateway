# Zaino AI Portal — Product Gap Audit

**Date:** 2026-10-17  
**Scope:** Frontend portal (`portal/app/`, `portal/components/`)  
**Perspective:** Startup Product Manager  
**Backend status:** Production-proven (all money paths, metering, admin console, D17 flow verified end-to-end)

---

## Executive Summary

The Zaino AI backend is significantly ahead of the frontend. The gateway enforces budgets correctly across three model aliases (`fast`, `smart`, `frontier`) over eleven upstream deployments, the D17 manual-payment flow is trilingual and proven, and the admin console handles suspension, credits, and entitlement retries. The gap is **user-facing polish and self-service surfaces** that turn a working gateway into a product people can adopt without hand-holding.

This audit identifies **15 gaps** across three priority tiers. The top three (onboarding, empty states, notification center) directly block conversion, activation, and trust for a product whose payment path takes hours to clear.

---

## What Exists (Solid Foundation)

| Area | Route / Component | Status | Notes |
|---|---|---|---|
| Landing page | `/` | ✅ Hero + navbar only | Features/footer sections removed; components exist in `components/marketing/**` but are unmounted |
| Pricing page | `/pricing` | ✅ Live | Two plans (Starter $19 / Pro $99), D17 payment mentioned, badge with prices |
| Documentation | `/docs`, `/dashboard/docs` | ✅ Public + in-app | Integration guide with Codex CLI and Claude Code configs; same `DocsContent` component renders both places with CTA retargeted |
| Legal pages | `/terms`, `/privacy` | ✅ Complete | Tunisian-law-specific, dated Oct 17 2026, proper sections, contact emails |
| Auth flows | `/sign-in`, `/sign-up`, `/reset-password`, `/verify-email` | ✅ Wired | Session invalidation on password change, email verification gate at checkout/keys, token-based confirmation (POST, not GET) |
| Dashboard shell | `(app)/layout.tsx` | ✅ Sidebar + header + identity | `app-sidebar.tsx`, `site-header.tsx`, `shell-identity.tsx` — identity from `/api/orgs`, no hardcoded user |
| Overview | `/dashboard` | ✅ Real data | Spend meter, stat cards, recent activity, keys panel — all fetched client-side from `/api/subscription` + `/api/keys` |
| Keys management | `/dashboard/keys` | ✅ Wired | Create/revoke/list via `KeysView`, connected to live API |
| Usage | `/dashboard/usage` | ✅ Table + chart | Server-bucketed series (`/api/usage/summary`), alias-only ledger, CSV export, area chart |
| Billing | `/dashboard/billing` | ✅ Plan card + paywall | `BillingView` with plan card, paywall state, spend meter |
| Settings | `/dashboard/settings` | ✅ Profile + password | `SettingsForms` wired to `/api/profile` and `/api/profile/password` |
| Admin console | `/admin` | ✅ Staff-gated | Org list, suspend/reactivate, entitlement retry, credit notes; role-checked server-side |
| D17 queue | `/admin/d17` | ✅ Staff-gated | Proof review, approve/reject, screenshot viewer, CSV export |
| D17 checkout | `/checkout/d17/[subscriptionId]` | ✅ Full flow | Visual stepper (Transfer → Proof → Verification), trilingual (FR/AR/EN), RTL support, status-aware rendering, proof upload with EXIF stripping |
| Marketing footer | `components/marketing/footer.tsx` | ✅ Present | Rendered on docs, terms, privacy pages |
| Navbar | `components/shadcn-space/blocks/hero-33/navbar.tsx` | ✅ Shared | Used across marketing pages, tone-aware (light/dark) |

### Backend Capabilities Not Yet Surfaced in UI

These are proven in `make verify-metering` and `make verify-d17` but have **no customer-facing UI**:

- Trial eligibility and activation (7-day Starter trial)
- Anomaly alerts (cross-org phone reuse, rejected-proof burst, hard-cap breach, oversized request)
- Subscription resume after cancellation
- Account deletion with key revocation
- Credit notes (manual refund record)
- Email verification resend
- Password reset with session invalidation

---

## 🔴 Critical Gaps (P0 — Block Revenue or Trust)

### 1. No Onboarding / First-Run Experience

**Problem:** A new user signs up, hits the paywall, and sees a billing page. There is no guided flow: "here's what Zaino does → pick a plan → make your first API call." The docs exist at `/docs` but nothing funnels users there from the dashboard or the post-signup redirect.

**Impact:** Conversion killer. Developers evaluating Zaino bounce before understanding the value proposition. The paywall is the first thing they see, not the product.

**Current state:** Post-signup redirects to `/dashboard`, which shows the paywall state (`paywall-state.tsx`). No stepper, no checklist, no "your first key" prompt.

**Recommendation:** Build a `/onboarding` flow or an inline onboarding overlay on the dashboard:
1. Welcome + 30-second value prop
2. Plan selection (link to `/pricing` or inline comparison)
3. After payment/trial: "Create your first key" with copy-to-clipboard
4. "Make your first request" with a curl snippet pre-filled with their key
5. Link to `/dashboard/docs` for full integration guide

**Effort:** Medium (3–5 days). Components for steppers and code blocks already exist.

---

### 2. Empty States Are Minimal or Missing

**Problem:** When a user has zero keys, zero usage, or no active subscription, they likely see generic "no data" tables or blank panels. These don't teach users what to do next.

**Impact:** Activation blocker. Users stare at empty dashboards and leave.

**Current state:** `components/dashboard/states.tsx` exists but its usage across views is unclear. The keys page, usage page, and billing page each need context-specific empty states:
- **Zero keys:** "Create your first API key to start making requests" + button
- **Zero usage:** "Your first request will appear here. Try this curl command:" + snippet
- **No subscription:** "Choose a plan to unlock API access" + link to pricing
- **Trial expired:** "Your trial ended. Subscribe to continue" + CTA

**Recommendation:** Audit every dashboard view for empty-state coverage. Use `states.tsx` as the base but customize messaging and CTAs per context.

**Effort:** Low (1–2 days). Mostly content + wiring existing components.

---

### 3. No Notification Center / Inbox

**Problem:** HANDOFF §5.9 explicitly removed the hardcoded notification feed. The replacement is "an Account-status menu with an unread dot only when a sync actually failed." Users have **no way to see**:
- Payment approved or rejected
- Trial expiring soon
- Budget at 80% / 95%
- Entitlement sync recovered
- Account suspended or reactivated

For a manual-payment product where D17 approval takes hours, this is a **trust gap**. Users submit proof and have no idea when it's reviewed.

**Impact:** Trust and retention. Users email support asking "did you get my payment?" because the portal tells them nothing.

**Current state:** `system_alerts` table exists (backend anomaly detection fires), `send_alerts` job emails ops, but there is no customer-facing notification surface. The shell identity has an unread dot for sync failures only.

**Recommendation:** Build a notification inbox:
- Bell icon in `site-header.tsx` with count badge
- Dropdown or `/notifications` page listing events (payment status changes, budget warnings, trial expiry, system announcements)
- Mark-as-read, mark-all-read
- Real-time updates via polling or SSE (the jobs infrastructure already supports event emission)
- Email digest option (daily/weekly summary)

**Data source:** A new `user_notifications` table populated by the existing job runner when relevant events occur. The `billing_events` and `system_alerts` tables already capture most triggers.

**Effort:** Medium (3–5 days). Backend event infrastructure exists; UI + query layer needed.

---

## 🟠 High-Priority Gaps (P1 — Hurt Retention or Self-Service)

### 4. No Budget Warning Banners in Dashboard

**Problem:** The backend has anomaly detection (`detect_anomalies` watches for hard-cap breaches) and `send_alerts` emails ops, but the dashboard has no "you're at 80% of your budget" banner. Users learn about their cap by hitting HTTP 429.

**Impact:** Retention. Hitting a hard stop mid-workflow is frustrating and feels like a bug. Proactive warnings reduce support tickets and build confidence.

**Current state:** `SpendMeter` component shows current spend vs. cap, but it's a passive gauge. No threshold-based banners, no email-preference toggle, no alert history visible to the customer.

**Recommendation:**
- Add threshold banners to the dashboard overview and usage page: yellow at 80%, orange at 95%, red at 100%
- Add a "Notifications" section to `/dashboard/settings` where users can toggle email alerts for budget thresholds, payment status, and trial expiry
- Surface the last N alerts in the notification center (see #3)

**Effort:** Low (1–2 days). `SpendMeter` already computes the ratio; conditional rendering + settings persistence.

---

### 5. Key Model-Scope Not Visible at Creation or in List

**Problem:** Keys are minted with the plan's model allowlist, but there's no visible indication of *which models* a key can access on the keys page, and no way to create a restricted key (e.g., `fast`-only for a CI runner). The team∩key intersection bug (§5.26) proved that invisible scoping causes real confusion.

**Impact:** Self-service and debugging. Users don't know why a model returns 403 when `/v1/models` says it's available.

**Current state:** `KeysView` lists keys with name, prefix, created date, and last-used. Model scope is not displayed. Key creation uses the plan's default allowlist with no override.

**Recommendation:**
- Show effective model list on each key row (badges: `fast`, `smart`, `frontier`)
- Add a "Model access" field to key creation (checkboxes, constrained to plan's allowlist)
- Add a tooltip explaining "effective access = key models ∩ team models"
- Consider a "restricted key" preset for CI/CD use cases

**Effort:** Low (1–2 days). Data is available from `/api/keys`; UI additions only.

---

### 6. No Invoice / Receipt Download

**Problem:** D17 payments are manual; staff approve them. But there's no customer-facing "download receipt" or "view payment history with statuses" beyond the billing view. For Tunisian business accounting, a downloadable PDF or structured receipt is table stakes.

**Impact:** Compliance and trust. Businesses need proof of payment for tax purposes. Without it, they can't expense Zaino.

**Current state:** `BillingView` shows the current plan and spend. `GET /api/billing/payments` exists and returns payment records. No download endpoint, no PDF generation, no payment history page with status timeline.

**Recommendation:**
- Add a "Payment history" tab to `/dashboard/billing` listing all `payments_d17` rows with status, amount, period, and authorization number
- Add a "Download receipt" button per approved payment (server-generated PDF or HTML receipt with Zaino branding, payment details, and period)
- Include the receipt in the approval email (already sent via `lib/email/`)

**Effort:** Medium (2–3 days). Payment data exists; PDF generation library needed (e.g., `@react-pdf/renderer` or server-side HTML-to-PDF).

---

### 7. Marketing Site Is Skeletal

**Problem:** Landing page = hero only. No features section, no social proof, no FAQ, no comparison table, no "how it works" steps. The components exist in `components/marketing/**` but are unmounted per HANDOFF §5.8. A developer evaluating Zaino sees one headline and a pricing page.

**Impact:** Acquisition. The conversion funnel leaks every visitor who needs more than a headline to evaluate an API product.

**Current state:** `app/(marketing)/page.tsx` renders `Navbar` + `Hero33` only. Comment in the file confirms features/footer were removed. Components in `components/marketing/` are intact.

**Recommendation:** Re-mount the existing marketing components in order:
1. Hero (current)
2. Features / value props (3–4 cards: dual-format, spend ceilings, instant keys, D17)
3. How it works (3 steps: sign up → pay → integrate)
4. Model tiers (visual comparison of fast/smart/frontier)
5. Social proof / testimonials (even internal dogfooding quotes count)
6. FAQ (address D17 timing, model swapping, budget enforcement, Codex compatibility)
7. Footer with links to docs, pricing, legal, contact

**Effort:** Medium (2–3 days). Components exist; assembly + copywriting.

---

### 8. No Support / Help Surface

**Problem:** Terms and Privacy mention `support@zaino.ai`, but there's no in-app help widget, no FAQ, no ticket submission form, no status page link. When D17 approval takes 4 hours and a user is stuck, they have only email.

**Impact:** Trust and support load. Every question becomes an email thread. Self-service reduces ops burden.

**Current state:** Zero in-app help. No `/help`, no `/status`, no intercom/crisp widget, no FAQ page.

**Recommendation (tiered):**
- **Quick win:** Add a `/faq` page covering the top 10 questions (D17 timing, key format, model aliases, budget enforcement, Codex setup, password reset, account deletion)
- **Medium:** Add a "Help" link in the dashboard sidebar that opens a modal with FAQ search + email contact form
- **Later:** Integrate a lightweight help widget (Crisp, Tawk.to) or build a `/support/tickets` system backed by the existing email transport

**Effort:** Quick win = Low (1 day). Medium = Medium (2–3 days).

---

## 🟡 Medium-Priority Gaps (P2 — Polish & Scale)

### 9. No Team / Org Management UI

**Problem:** Backend supports org roles (viewer/developer/billing/admin/owner) per IMPLEMENTATION.md §1.1, but the frontend has no members page, no invite flow, no role management. Currently single-user-only in practice.

**Impact:** Expansion. Teams can't share accounts, so each developer gets their own subscription. Revenue ceiling per org.

**Current state:** `organizations` table has role infrastructure. No `/dashboard/team` route. No invite email flow. No member list UI.

**Recommendation:** Defer until first multi-user customer signals demand. Schema is ready; UI is a 1–2 week effort.

**Effort:** High (1–2 weeks).

---

### 10. No API Playground / Test-Request Tool

**Problem:** Developers want to try a model before integrating. A simple "send a test prompt" widget on the docs or keys page would dramatically reduce time-to-first-token.

**Impact:** Activation. Reduces friction between "I have a key" and "I see it works."

**Current state:** Docs show curl snippets. No interactive playground.

**Recommendation:** Embed a lightweight playground in `/dashboard/docs`:
- Model selector (fast/smart/frontier)
- Prompt textarea
- "Send" button → streams response
- Token count + cost display
- Copy-as-curl button

**Caveat:** Must use the user's own key and count against their budget. No server-side proxy that bypasses metering.

**Effort:** Medium (3–5 days). Streaming SSE handling + UI.

---

### 11. No Mobile-Responsive Bottom Navigation

**Problem:** Dashboard uses a sidebar (`app-sidebar.tsx`). On mobile this likely collapses to a hamburger menu, but there's no evidence of a dedicated mobile bottom navigation pattern. Tunisian users may primarily use phones for dashboard checks.

**Impact:** Usability. Sidebar-on-mobile is awkward for frequent quick checks (spend, key status).

**Current state:** Unknown responsive behavior. `app-sidebar.tsx` needs audit.

**Recommendation:** Audit current mobile behavior. If sidebar collapses poorly, add a bottom nav bar for mobile viewports with 4–5 primary destinations (Overview, Keys, Usage, Billing, Settings).

**Effort:** Low–Medium (2–3 days). CSS media queries + conditional rendering.

---

### 12. No Dark / Light Mode Toggle

**Problem:** Dashboard is dark, marketing is light (`light-surface` token scope in `globals.css`). No user preference toggle, no system-preference detection. The split is architectural, not user-controlled.

**Impact:** Polish. Some users prefer light dashboards; some prefer dark marketing pages. Forced contrast feels unfinished.

**Current state:** `globals.css` defines both token sets. `light-surface` class overrides dark tokens on marketing pages. No `ThemeProvider` or preference persistence.

**Recommendation:** Add a theme toggle to `site-header.tsx`:
- System / Light / Dark options
- Persist to `localStorage`
- Apply via CSS class on `<html>` or `<body>`
- Respect `prefers-color-scheme` as default

**Effort:** Low (1–2 days). Token infrastructure exists.

---

### 13. No Localization Beyond D17 Checkout

**Problem:** D17 checkout has FR/AR/EN with RTL support (`lib/i18n/d17.ts`). The rest of the portal is English-only. For a Tunisian product, Arabic and French dashboard/UI strings are expected.

**Impact:** Market fit. French is the business language in Tunisia; Arabic is the national language. English-only signals "not for us" to many potential customers.

**Current state:** `t17()` function handles D17 translations. No general i18n framework. All other strings are hardcoded English.

**Recommendation:** Adopt `next-intl` or similar. Phase approach:
1. Extract all UI strings to message files (en, fr, ar)
2. Add language selector to settings
3. Translate dashboard labels, buttons, empty states, error messages
4. RTL layout pass for Arabic

**Effort:** High (1–2 weeks). Large string extraction + translation + RTL testing.

---

### 14. No SEO / Content Pages Beyond Landing + Pricing

**Problem:** No blog, no tutorials, no model comparison content, no "why Zaino" page. Organic discovery is near-zero.

**Impact:** Long-term acquisition. API products live or die by developer content marketing.

**Current state:** `/docs` is the only content page. No `/blog`, no `/guides`, no sitemap entries beyond the basics (`sitemap.ts` exists).

**Recommendation:** Start with 3–5 high-value content pieces:
- "How to use Claude Code with Zaino" (tutorial)
- "Understanding model tiers: fast vs smart vs frontier" (explainer)
- "D17 payment guide for Tunisian developers" (localized)
- "Migrating from OpenAI to Zaino in 10 minutes" (migration guide)
- "Zaino vs direct API: cost comparison" (value prop)

**Effort:** Ongoing. Each piece = 1–2 days writing + SEO optimization.

---

### 15. No Changelog / What's-New Surface

**Problem:** The platform ships frequently (11 migrations, multiple model additions, Responses shim, auth-edge). Users have zero visibility into new models, new tiers, or feature launches. Customers can't discover that `frontier` now exists or that Codex CLI is supported.

**Impact:** Engagement and perceived momentum. Silent improvements don't drive upgrades or word-of-mouth.

**Current state:** No `/changelog`, no in-app announcement banner, no release notes.

**Recommendation:**
- Add a `/changelog` page (markdown-driven, easy to update)
- Add a "What's new" banner in the dashboard for significant releases (dismissable, stored per-user)
- Link changelog from the footer and the docs page

**Effort:** Low (1–2 days). Static page + optional banner component.

---

## Priority Matrix

| # | Gap | Priority | Impact | Effort | Dependencies |
|---|---|---|---|---|---|
| 1 | Onboarding flow | 🔴 P0 | Conversion | Medium | None |
| 2 | Rich empty states | 🔴 P0 | Activation | Low | None |
| 3 | Notification center | 🔴 P0 | Trust (D17) | Medium | `user_notifications` table |
| 4 | Budget warning banners | 🟠 P1 | Retention | Low | None |
| 5 | Key model-scope display | 🟠 P1 | Self-service | Low | None |
| 6 | Receipt/invoice download | 🟠 P1 | Compliance | Medium | PDF library |
| 7 | Marketing site completion | 🟠 P1 | Acquisition | Medium | Existing components |
| 8 | Support / help surface | 🟠 P1 | Trust | Low–Medium | None |
| 9 | Team management UI | 🟡 P2 | Expansion | High | Demand signal |
| 10 | API playground | 🟡 P2 | Activation | Medium | Metering integration |
| 11 | Mobile bottom nav | 🟡 P2 | Usability | Low–Medium | Responsive audit |
| 12 | Dark/light mode toggle | 🟡 P2 | Polish | Low | Token infrastructure |
| 13 | FR/AR dashboard i18n | 🟡 P2 | Market fit | High | i18n framework |
| 14 | SEO / content pages | 🟡 P2 | Acquisition | Ongoing | Content strategy |
| 15 | Changelog / what's-new | 🟡 P2 | Engagement | Low | None |

---

## Recommended Implementation Order

### Sprint 1 (Week 1): Quick Wins That Unblock Trust
- **#2** Rich empty states (Low effort, immediate activation impact)
- **#4** Budget warning banners (Low effort, prevents 429 surprises)
- **#5** Key model-scope display (Low effort, prevents 403 confusion)
- **#15** Changelog page (Low effort, signals momentum)

### Sprint 2 (Week 2): Conversion & Trust Foundations
- **#1** Onboarding flow (Medium effort, conversion multiplier)
- **#3** Notification center (Medium effort, D17 trust foundation)
- **#8** FAQ page (Low effort, reduces support load)

### Sprint 3 (Week 3): Acquisition & Compliance
- **#7** Marketing site completion (Medium effort, existing components)
- **#6** Receipt download (Medium effort, business compliance)
- **#12** Dark/light mode toggle (Low effort, polish signal)

### Sprint 4+ (Ongoing): Scale & Market Fit
- **#10** API playground
- **#11** Mobile nav audit
- **#13** FR/AR i18n
- **#14** Content pages
- **#9** Team management (when demand signals)

---

## Technical Notes

### Existing Infrastructure to Leverage
- **Job runner:** Already runs 5 jobs (`collect_usage`, `expire_subscriptions`, `send_alerts`, `expire_trials`, `detect_anomalies`). Notification events can be emitted here.
- **Email transport:** `lib/email/` seam supports Resend + dev log. Notification emails reuse this.
- **API layer:** `lib/api/use-api.ts` + `apiSend` handle all client-side fetching with error unwrapping and stale-data management. New endpoints follow this pattern.
- **Component library:** shadcn/ui + Base UI primitives. Tabs, badges, buttons, forms all exist. New UI follows established patterns.
- **Token system:** `globals.css` defines both light and dark tokens. Theme toggle is a CSS-class swap.
- **D17 i18n:** `lib/i18n/d17.ts` proves the translation pattern. Generalize to `lib/i18n/` for portal-wide use.

### Constraints to Respect
- **Never weaken metering.** Any playground or test-request feature must go through the real gateway path with the user's key. No server-side bypass.
- **Alias-only surface.** Customer-facing UI never shows upstream model names. Ledger CHECK constraint enforces this at the DB level; UI must match.
- **Staff/customer separation.** Staff pages (`/admin/*`) are never reachable by customers. Role checks are server-side on every route.
- **D17 receiver phone is secret.** Never render `D17_RECEIVER_PHONE` in client-side code. It's server-rendered only in the checkout instructions.
- **`light-surface` token scope.** Marketing pages require this class to override dark tokens. Any new marketing page must include it.

---

*Generated from a read-only audit of the portal frontend on 2026-10-17. Backend capabilities verified against HANDOFF.md (1243 lines), CONTEXT.md, DESIGN.md, PLATFORM.md, and live stack documentation.*