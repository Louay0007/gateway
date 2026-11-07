-- ══════════════════════════════════════════════════════════════════════
--  0037_dodo_and_seat_prices.sql — two rails, two exact prices
--
--  Until now there was ONE price per plan, in USD cents, and the dinar
--  amount was reverse-engineered from it at D17_USD_TND_RATE (0024: 50 DT
--  is 1613 cents at 3.1). That worked while D17 was the only rail.
--
--  Dodo Payments (the new international rail) charges USD, and the ask is
--  exactly $15 / $30 — not "whatever 50 DT converts to". So the two
--  numbers become independent:
--
--    plans.price_cents          the USD list price, charged by Dodo
--    plans.price_tnd_millimes   the exact dinar ask, charged by D17
--
--  NEITHER IS DERIVED FROM THE OTHER, and no rate converts between them at
--  checkout. This reverses what 0024 documented; a reader who only sees
--  0024 will re-derive 1613 and undercut the $15 price.
--
--  price_tnd_millimes is nullable: NULL means "no dinar price, fall back
--  to planPriceTndMillimes(cents, rate)" for any plan that has no local
--  ask (e.g. a USD-only plan added later).
--
--  Pro is now sold per seat. subscriptions.seats records what the customer
--  bought; Dodo's product_cart quantity equals it, and Starter is pinned
--  to one seat. Provider is stored on the row because with two rails live
--  the *configured* provider is no longer necessarily the one that sold
--  this subscription (the audit log was reading billingProvider.name).
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_tnd_millimes INTEGER;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS seats    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_seats_positive'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_seats_positive CHECK (seats >= 1);
  END IF;
END $$;

UPDATE plans
   SET price_cents        = 1500,
       price_tnd_millimes = 50000,
       max_seats          = 1,
       updated_at         = now()
 WHERE code = 'starter';

UPDATE plans
   SET price_cents        = 3000,
       price_tnd_millimes = 90000,
       max_seats          = 25,
       updated_at         = now()
 WHERE code = 'pro';
