-- 0048: raise ZAINO-PARTNER-3D's redemption cap to cover the full outreach list
--
-- 0047 capped the partner code at 60 redemptions. The outreach list finalised
-- on 2026-11-19 has 115 unique addresses, so 55 of them would receive an email
-- whose code answers "All redemptions for this code have been claimed" — a
-- worse outcome than not mailing, because it costs a redemption of trust.
--
-- 120 leaves headroom over the 115 for a few re-sends without making a leak
-- unbounded: at 4M weighted units and 0.20 DT per 1M, the entire campaign's
-- worst case is 120 x 0.80 = 96 DT. The alternative, max_redemptions = 0
-- (unlimited), is deliberately not used — a code posted to a public group would
-- then have no ceiling at all, and a redemption cannot be undone.
--
-- This is a cap, not a grant. It changes nothing about what a redeemer gets;
-- that still comes from the shared `trial` plan row set by 0047.

UPDATE trial_codes
   SET max_redemptions = 120
 WHERE code = 'ZAINO-PARTNER-3D';

-- Guard: the cap must be able to serve the list it was raised for, and must not
-- be unlimited. A silent fall-through to 0 here would invert the intent.
DO $$
DECLARE
  cap integer;
BEGIN
  SELECT max_redemptions INTO cap FROM trial_codes WHERE code = 'ZAINO-PARTNER-3D';

  IF cap IS NULL THEN
    RAISE EXCEPTION 'ZAINO-PARTNER-3D is missing; 0047 should have inserted it';
  END IF;

  IF cap < 115 THEN
    RAISE EXCEPTION
      'partner code cap is %, below the 115 addresses on the outreach list', cap;
  END IF;

  IF cap = 0 THEN
    RAISE EXCEPTION 'partner code cap is 0 (unlimited); a leaked code would be unbounded spend';
  END IF;
END $$;
