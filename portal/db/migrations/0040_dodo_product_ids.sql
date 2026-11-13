-- ══════════════════════════════════════════════════════════════════════
--  0040_dodo_product_ids.sql — map each plan to its Dodo product.
--
--  THE BUG. `POST /api/checkout {method:"dodo"}` answered 500 with:
--
--    dodo: plan starter has no provider_price_id — create the product in
--    Dodo and paste its id into plans.provider_price_id.
--
--  The products ALREADY EXIST in the Dodo dashboard at exactly the right
--  prices; only the mapping back into `plans` was never written. Dodo
--  checkout therefore failed for every customer on the international rail
--  while the D17 rail kept working, which is why it went unnoticed.
--
--  These ids were read from the live Dodo API (GET /products) with the
--  deployment's own key in test_mode, not copied from a dashboard page:
--
--    pdt_0NrQPphzbadXvGi8f3nzM  Zaino AI Starter Plan  1500 USD, recurring
--    pdt_0NrQQ1TIoKKqZi0k9OVtR  Zaino AI Pro Plan      3000 USD, recurring
--
--  ⚠ TEST MODE. Those products live in Dodo's test environment, and
--  DODO_PAYMENTS_ENVIRONMENT is `test_mode`, so a checkout started now is
--  a TEST payment: no money moves. Going live needs a second, separate
--  migration with the live-mode product ids AND the environment flipped —
--  deliberately not done here, because silently switching a deployment to
--  charging real cards is not something a bug fix should do.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

UPDATE plans
   SET provider_price_id = 'pdt_0NrQPphzbadXvGi8f3nzM',
       updated_at        = now()
 WHERE code = 'starter';

UPDATE plans
   SET provider_price_id = 'pdt_0NrQQ1TIoKKqZi0k9OVtR',
       updated_at        = now()
 WHERE code = 'pro';

-- The hidden trial plan is never sold, so it must NOT carry a product id —
-- a stray id would make a free plan purchasable.
UPDATE plans
   SET provider_price_id = NULL,
       updated_at        = now()
 WHERE code = 'trial';

-- ── Guards ────────────────────────────────────────────────────────────
-- A paid, public plan with no product id is a 500 for every card customer,
-- which is exactly the outage this migration exists to end.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(code) INTO bad
    FROM plans
   WHERE public = TRUE
     AND price_cents > 0
     AND (provider_price_id IS NULL OR provider_price_id = '');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0040: paid public plan(s) with no Dodo product id: %',
      array_to_string(bad, ', ');
  END IF;
END $$;

-- Starter and Pro must not share a product, or one checkout would grant the
-- other plan.
DO $$
DECLARE
  dup text;
BEGIN
  SELECT provider_price_id INTO dup
    FROM plans
   WHERE provider_price_id IS NOT NULL
   GROUP BY provider_price_id
  HAVING count(*) > 1
   LIMIT 1;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '0040: Dodo product id % is mapped to more than one plan', dup;
  END IF;
END $$;
