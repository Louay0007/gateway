-- ══════════════════════════════════════════════════════════════════════
--  0044_remove_seats.sql — retire a billed capability we never delivered.
--
--  WHY. 0037 introduced per-seat pricing: `plans.max_seats` (1 on
--  Starter, 25 on Pro) and `subscriptions.seats`, with the Dodo rail
--  sending it as `product_cart.quantity`. Nothing ever read it back.
--
--  `organization_members` has exactly ONE writer in the whole codebase —
--  signup provisioning, which inserts the owner row. There is no invite
--  route, no member list API, no member UI and no seat-count check on
--  any request path. The D17 rail (the Tunisian La Poste flow) never had
--  a seat field at all.
--
--  So a Pro buyer was sold "25 seats" on the pricing page, charged N× on
--  the card rail for asking, and received a product where only the owner
--  can ever hold a key. That is a promise the code cannot keep, and the
--  honest fix for a promise you are not building is to stop making it —
--  not to leave a column that documents a feature nobody can reach.
--
--  This file SUPERSEDES 0037 rather than editing it: migrations are
--  forward-only and ledger-guarded (scripts/db-migrate.sh), so 0037 stays
--  on disk exactly as it ran on every existing database. A fresh install
--  still creates both columns in 0037 and drops them here, which is the
--  price of a rewrite-free history and is cheaper than the alternative:
--  a ledger that says "applied" for a file that no longer matches what
--  it did.
--
--  Nothing reads either column after this deploy — checkout, the
--  entitlement sync, the marketing table and the dashboard summary all
--  drop the field in the same commit — so the DROP is not a data loss
--  anyone can observe. It removes history for seats that were never
--  usable, which is the point.
-- ══════════════════════════════════════════════════════════════════════

-- The CHECK constraint goes with its column, but name it explicitly so
-- the intent survives in the migration log for anyone reading the DDL.
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_seats_positive;

ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS seats;

ALTER TABLE plans
  DROP COLUMN IF EXISTS max_seats;
