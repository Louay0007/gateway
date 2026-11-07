# Handover — Dodo Payments as the international rail

**Date:** 2026-11-07
**Branch:** `main` (NOT branched yet — branch before committing)
**State:** mid-implementation, does not typecheck yet. 12 modified files, 2 new.

---

## The goal (locked, do not re-litigate)

Keep **D17 (La Poste Tunisienne)** for Tunisian customers. Add **Dodo Payments** as a second rail for international customers. Two independent exact prices — no conversion at checkout:

| Plan | USD (Dodo) | TND (D17) | Seats |
|---|---|---|---|
| starter | $15 | 50 DT | 1 (flat) |
| pro | $30 **per seat** | 90 DT | up to 25 |

We absorb Dodo's fee (6% + $0.40 on international subscriptions). Customer pays the clean number.

Full plan: `/Users/user/.claude/plans/floating-shimmying-quokka.md`

---

## DONE (written, unverified — typecheck fails, see below)

### New files

**`portal/db/migrations/0037_dodo_and_seat_prices.sql`**
- `plans.price_tnd_millimes INTEGER` (nullable — NULL = derive from cents)
- `subscriptions.seats INTEGER NOT NULL DEFAULT 1` + `CHECK (seats >= 1)`
- `subscriptions.provider TEXT` (`'dodo' | 'd17' | NULL`)
- Prices: starter 1500/50000/max_seats 1, pro 3000/90000/max_seats 25
- Header comment explains that `price_cents` is now USD and `price_tnd_millimes` the dinar ask — this **reverses** what `0024_plan_base_prices.sql` says. Read both before touching prices again.

**`portal/lib/billing/dodo.ts`** — the provider. No SDK; `fetch` + `node:crypto`.
- `begin()` → `POST {base}/checkouts` with `product_cart: [{product_id, quantity: seats}]`, `customer.email` = org owner's, `metadata: {organization_id, subscription_id}`
- `verify()` → hand-rolled Standard Webhooks: `hmac(secret, "id.ts.rawBody")`, base64, `v1,` prefix, space-separated multi-entry list, 300s replay window, `timingSafeEqual`
- Event map: `subscription.active|renewed → activated`; `past_due|on_hold → payment_failed`; `cancelled|expired → canceled`; everything else → **`null`**
- `cancel()` → `PATCH /subscriptions/{id}` `{cancel_at_next_billing_date:true}`, strips `dodo-` prefix, swallows 404
- Exports `dodoSign`, `dodoVerifySignature`, `dodoEventKind`, `dodoBaseUrl`, `DODO_WEBHOOK_HEADERS` (all for tests)
- Env: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY` (strips `whsec_`), `DODO_PAYMENTS_ENVIRONMENT` (`test_mode`|`live_mode`)

### Modified files

| File | Change |
|---|---|
| `portal/db/schema.ts` | `plans.priceTndMillimes`; `subscriptions.provider`, `subscriptions.seats` |
| `portal/lib/billing/types.ts` | `name: 'dev'\|'d17'\|'dodo'`; `BeginCheckoutInput.seats`; `verify → ProviderEvent \| null` |
| `portal/lib/billing/index.ts` | `PROVIDERS` gains `dodo`; `configuredName()` uses `name in PROVIDERS` (was a hardcoded `'d17'\|'dev'` allowlist) |
| `portal/app/api/checkout/route.ts` | `method: z.enum(['d17','dodo'])`; `seats: z.coerce.number().int().min(1).max(99)`; threads seats |
| `portal/app/api/billing/callback/route.ts` | **Rewritten.** Picks the rail by `webhook-id` presence (Dodo always sends it, dev never does). Passes all 4 signature headers. Returns `{ok:true, ignored:true}` on `null`. |
| `portal/lib/billing/service.ts` | `beginCheckout(..., seats)`; new `coerceSeats()` clamps to `plan.maxSeats`; writes `provider` + `seats` on the row; audit + cancel now read `sub.provider` not `billingProvider.name` |
| `portal/lib/billing/d17.ts` | Prefers `plan.priceTndMillimes`; falls back to `planPriceTndMillimes()` only when no exact ask (promo path still converts) |
| `portal/lib/billing/state.ts` | `PlanSummary` gains `priceTndMillimes: number \| null` + `maxSeats: number`; `summarizePlan` input gains both (optional, defaulted) |
| `portal/lib/dashboard/format.ts` | New `usdPrice()`, `tndPrice()`, `formatPlanPrice(usdCents, tndMillimes, seats)`. **`centsDt` / `centsDtNumber` / `D17_RATE` kept only for USAGE display**, not plan prices. |
| `portal/app/(marketing)/pricing/page.tsx` | Badge uses `formatPlanPrice` |
| `portal/components/marketing/pricing-preview.tsx` | Both prices |
| `portal/components/ui/interactive-pricing-component.tsx` | **Half-converted.** `PricingPlan.monthlyPrice/annualPrice/promo` → single `priceLabel: string \| null`. Annual toggle + local promo math + fallback prices DELETED. |

---

## NOT DONE — the typecheck failures, in order

`cd portal && npx tsc --noEmit`:

1. **`interactive-pricing-component.tsx`** — 12 errors. I removed the annual-billing state but the JSX still references it. Two render blocks need finishing (~line 268-300 card, ~line 352-372 comparison table):
   - delete `formatOriginalPrice(plan)` blocks and the strikethrough
   - delete `{!plan.customPrice && <span>/{billingCycle === 'annual' ? 'mo' : 'month'}</span>}` → replace with `/month`
   - delete the `{plan.promo ? … % off}` badge
   - delete the `billingCycle === 'annual' … "Billed annually · Save"` block
   - add `import { formatPlanPrice } from '@/lib/dashboard/format'`
   - drop now-unused imports: `HALLOWEEN_PROMO`, `promoActive`, `Switch`, possibly `Badge`, `useCallback` if unused
   - `app/(marketing)/page.tsx:103` calls `<PricingComponent />` with no props — fine
2. **`app/api/billing/callback/route.ts`** — `BillingError` no longer imported (I dropped it from the import line). Add it back: `import { applyCallback, BillingError } from '@/lib/billing';`
3. **`tests/billing.test.ts:52-56`** — `verify()` now returns `ProviderEvent | null`. Add a non-null assertion or an `expect(event).not.toBeNull()` guard before the property reads.

Then: **`npm test`** — `tests/d17.test.ts` and `tests/promo.test.ts` pin `1613`/`2903` (the old DT-derived cents). They must move to `1500`/`3000`; the `50`/`90` DT assertions stay green.

---

## STILL TO DO (after typecheck is green)

### 5b — remaining price surfaces
| File | Line | Action |
|---|---|---|
| `components/dashboard/billing-view.tsx` | 520, 523, 674, 677, 758, 759 | `centsDt` → `formatPlanPrice`; needs `priceTndMillimes` from `PlanSummary` |
| `components/dashboard/paywall-state.tsx` | 119, 121 | USD first — the rail a new intl customer uses |
| `components/dashboard/site-header.tsx` | 155 | `usdToTnd` on *spend* — arguably fine (usage, not plan price). Decide: keep, or show USD. |
| `app/billing/confirm/page.tsx` | 181, 201 | dev-only confirm page — `centsDt` is still there |
| `components/docs/docs-hero.tsx` | 111-112 | hardcodes `promoView(1613)` — must read `listPlans()` |
| `lib/admin/financials.ts` | 92 | sums `payments_d17.usd_amount_cents` as "collected USD". Correct today, wrong once Dodo is live. **Add a comment only, do not change the query.** |
| `components/marketing/changelog-content.tsx` | 28, 35-36, 44 | dated historical copy — **leave alone** |

### 6 — Billing UI (`components/dashboard/billing-view.tsx`)
- `beginCheckout(planCode, method?: "d17")` at :173 → `"d17" | "dodo"`, plus `seats` in the request body
- Two call sites pass `'d17'` unconditionally: :453, :643
- Hero card :383-420 is D17-only → two-option selector (D17: TND, "transfer, we confirm within hours" / Card: USD, instant). Keep `/images/d17-logo.webp` block, add a card block beside it.
- Seat `<select>` 1..`plan.maxSeats` next to Pro. Server re-validates via `coerceSeats`.
- `PendingBanner` :928 keys off `d17PaymentStatus` — already null for Dodo, leave.

### 7 — Env + docs
- `.env.example` (~:109-154, next to D17 block): `BILLING_PROVIDER=dev # the DEFAULT rail, does not disable the others`, `DODO_PAYMENTS_API_KEY=`, `DODO_PAYMENTS_WEBHOOK_KEY=`, `DODO_PAYMENTS_ENVIRONMENT=test_mode`
- `docker-compose.yml` — pass the 3 Dodo vars to `portal` **and** `jobs`
- `docs/dodo-payments.md` — mirror `docs/d17-payments.md`. **Must state:** both products need `subscription_period` = 20 years or the subscription expires after one charge. Webhook events to subscribe: `subscription.active`, `renewed`, `past_due`, `on_hold`, `cancelled`, `expired`. Manual QA checklist.
- `CPO_ROADMAP.md` / `README.md` — one line each on the two rails

### 8 — Tests
- **`portal/tests/dodo.test.ts`** (new) — signature accept / tampered body / wrong secret / stale timestamp / multi-entry list; event mapping incl. `subscription.updated → null`; missing `metadata.organization_id` throws. Follow `tests/billing.test.ts` shape (no DB, instantiate directly).
- Update `tests/d17.test.ts` + `tests/promo.test.ts` pins 1613/2903 → 1500/3000

### 9 — Verify
- `npm run typecheck && npm test`
- `make verify-d17` — must still ask for exactly **50.000** / **90.000 DT** (catches a Step-4 regression)
- `make verify-metering`
- Dodo test mode by hand (needs live keys — user only)

---

## Manual steps only the user can do

1. Create two products in the Dodo dashboard:
   - Starter: $15/mo, **flat** (quantity 1)
   - Pro: $30/mo, **seat-based** (quantity = seats)
   - Both: `subscription_period` = **20 years** (Dodo's max). Anything equal to the billing frequency means the subscription dies after one charge.
2. Paste both product ids into `plans.provider_price_id` (starter row, pro row).
3. Register webhook endpoint `https://<host>/api/billing/callback`, subscribe to the 6 events above, copy the `whsec_…` secret into `DODO_PAYMENTS_WEBHOOK_KEY`.

---

## Gotchas found while building

- `POST /subscriptions` is **deprecated** at Dodo; `POST /checkouts` is the supported path.
- Checkout sessions are **single-use** and expire in 24h. `beginCheckout` already refuses a second checkout for a live subscription, so re-entry only happens in a renewal window — which wants a new session anyway.
- Dodo's MSA says 5% + 50¢ while the pricing page says 4% + $0.40. Their fee numbers disagree with each other; budget for the higher one.
- 120-day fund holds on closed accounts are common in reviews.
- The callback route discriminates rails by `webhook-id` header presence. If that ever changes, both rails' webhooks break silently with 400s and the customer stays on `incomplete`.
- `coerceSeats()` **clamps** rather than throws — a body asking for 5 seats on Starter gets 1. Deliberate: the picker renders from `maxSeats`, so a mismatch means a stale page, not an attack, and a 400 would fail a payment the customer can't fix.
