# Dodo Payments — international rail

Dodo is a Merchant of Record: hosted checkout, cards, renewals,
tax/VAT, dunning and chargebacks are its, not ours. The portal only
needs two things from it: create a checkout session, and verify
webhooks. There is no SDK — `portal/lib/billing/dodo.ts` is fetch +
`node:crypto` HMAC.

Pricing: we absorb Dodo's fee (6% + $0.40 on international
subscriptions), so the customer pays exactly `$15` (Starter, flat)
or `$30 × seats` (Pro). D17 (Tunisia, 50/90 DT) is unchanged —
`plans.price_cents` is the USD list price, `plans.price_tnd_millimes`
the exact dinar ask; neither is derived from the other (0037).

## Dashboard setup (once)

1. **Products**: create two subscription products.
   - `Starter`: $15/mo flat, quantity ignored.
   - `Pro`: $30/mo per seat (customer chooses quantity 1..25).
   - **Subscription period: 20 years.** Dodo warns that a period equal
     to the payment frequency expires after one charge. 20-year period
     + monthly frequency = ongoing monthly plan.
   - Paste both product IDs (Products → View Details) into
     `plans.provider_price_id` (starter row, pro row). `dodo.begin()`
     throws loudly if this is missing — nothing is charged until then.
2. **API key**: Developer → API Keys → `DODO_PAYMENTS_API_KEY`.
3. **Webhook**: Developer → Webhooks → Add endpoint.
   - URL: `https://<portal-domain>/api/billing/callback`
   - Subscribe exactly these events: `subscription.active`,
     `subscription.renewed`, `subscription.past_due`,
     `subscription.on_hold`, `subscription.cancelled`,
     `subscription.expired`.
   - Copy the signing secret (`whsec_...`) → `DODO_PAYMENTS_WEBHOOK_KEY`.

## Env

```
DODO_PAYMENTS_API_KEY=...
DODO_PAYMENTS_WEBHOOK_KEY=whsec_...
DODO_PAYMENTS_ENVIRONMENT=test_mode
```

Base URL is `test.dodopayments.com` (test_mode) or
`live.dodopayments.com` (live_mode). `BILLING_PROVIDER` is only the
default rail — a customer's `method` choice overrides it per checkout.

## How it works

- `POST /api/checkout {planCode, method:"dodo", seats}` →
  `beginCheckout` validates seats against `plans.max_seats` →
  `dodo.begin()` posts `/checkouts` with
  `product_cart:[{product_id, quantity:seats}]`,
  `billing_currency:"USD"` (locks currency at creation),
  `return_url` (absolute, resolved against `APP_URL`),
  `metadata:{organization_id, subscription_id}` → redirects to
  `checkout_url`. Sessions expire in 24h and are single-use.
- Webhooks are Standard Webhooks: sign
  `{id}.{timestamp}.{rawBody}` with the base64-decoded secret,
  `v1,<base64>`, 300s replay window, accept any entry in the
  space-separated list. Verified BEFORE parsing.
- Event map: `subscription.active/renewed → activated` (use
  `renewed`, not `payment.succeeded`, to extend access),
  `past_due/on_hold → payment_failed` (grace, access continues),
  `cancelled/expired/failed → canceled`.
  Everything else verifies to `null` → route answers
  `{ok:true, ignored:true}` so Dodo stops retrying.
- Dedupe: `webhook-id` is the `billing_events` id — replays are
  200 no-ops.
- Cancel: `PATCH /subscriptions/{id} {cancel_at_next_billing_date:true}`;
  404 is swallowed (already gone).

## Manual QA checklist (test mode)

- [ ] `POST /api/checkout {"planCode":"pro","method":"dodo","seats":3}`
      returns a `checkoutUrl` on `test.checkout.dodopayments.com`;
      the subscription row has `provider='dodo'`, `seats=3`.
- [ ] Pay with a Dodo test card → `subscription.active` arrives,
      `applyCallback` activates, `providerSubscriptionId` set, gateway
      key works.
- [ ] Replay the same webhook → `{duplicate:true}`, no second activation.
- [ ] `POST /api/subscription/cancel` → Dodo shows
      `cancel_at_next_billing_date`.
- [ ] `subscription.renewed` with a later `next_billing_date` moves
      `currentPeriodEnd` forward.
- [ ] `/pricing` shows `$15 / 50 DT` and `$30 per seat / 90 DT`, and the
      checkout page reads the same numbers.

Out of scope: Dodo discount codes (add when there is a real sale),
migrating D17 subscribers, a `payments_dodo` table (billing_events +
subscriptions record enough), proration on plan change (local-only
today, as documented in `service.ts`).
