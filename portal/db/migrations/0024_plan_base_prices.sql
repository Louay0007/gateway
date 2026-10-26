-- ══════════════════════════════════════════════════════════════════════
--  0024_plan_base_prices.sql — Starter/Pro at 50 DT / 90 DT list
--
--  The plans were seeded at 1900/9900 USD cents, which converts to
--  59/307 DT at the D17 rate — while every marketing surface advertised
--  50/90 DT. The catalog is the number the gateway, the checkout and the
--  landing page must agree on, so the catalog is what moves: 50 DT and
--  90 DT at the configured 3.1 rate are 1613 and 2903 cents.
--
--  D17 transfers are collected in whole dinars (planPriceTndMillimes in
--  lib/billing/d17-config.ts), so the customer is asked for exactly
--  50.000 / 90.000 TND, and 35.000 / 63.000 during the Halloween sale.
--
--  This is a LIST PRICE correction, not the promotion. The Halloween
--  discount lives in code (lib/billing/promo.ts) so it expires on its own
--  and never rewrites billing history.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

UPDATE plans
   SET price_cents = 1613,
       updated_at  = now()
 WHERE code = 'starter';

UPDATE plans
   SET price_cents = 2903,
       updated_at  = now()
 WHERE code = 'pro';
