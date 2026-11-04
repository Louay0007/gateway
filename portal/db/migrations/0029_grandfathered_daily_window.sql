-- ══════════════════════════════════════════════════════════════════════
--  0029_grandfathered_daily_window.sql — fix the units bug 0025 shipped.
--
--  THE BUG. 0025 replaced the monthly token wall with a DAILY one and
--  rewrote `plans.token_limits` to the new per-day numbers (100M per
--  alias). It also grandfathered every live paid row onto the LEGACY
--  MONTHLY window (`subscriptions.daily_quota = FALSE`).
--
--  Those two decisions are individually reasonable and jointly wrong:
--  a PER-DAY budget is summed over a PER-MONTH window. The effective
--  monthly allowance became 100M instead of the ~3B that "100M/day"
--  promises — and worse, it silently cut customers below what 0023 had
--  already sold them:
--
--     Pro smart      210M/month (0023, paid for)  ->  100M/month  (-52%)
--     Pro frontier    85M/month (0023, paid for)  ->  100M/month
--     Starter fast    80M/month (0023, paid for)  ->  100M/month
--     Starter smart   32M/month (0023, paid for)  ->  100M/month
--
--  Measured on production before this migration: a paying Pro customer
--  sat at smart 100,038,167 — over the 100M cap the wall applied, but
--  comfortably under the 210M he was sold. His team allowlist was `[]`,
--  which LiteLLM reads as UNRESTRICTED (see the NO_MODEL sentinel in
--  lib/litellm/client.ts), so the bug was invisible: the dashboard said
--  "out of tokens" while inference kept succeeding.
--
--  THE FIX. Move grandfathered rows onto the daily window too, which is
--  what `plans.token_limits` has described since 0025 and what every
--  marketing surface advertises ("100M per tier per day, resetting at
--  midnight Tunis time"). This is a strict improvement for every
--  grandfathered customer: it restores far MORE allowance than they have
--  today, never less.
--
--  WHY NOT restore the 0023 monthly numbers instead. Because the catalog
--  is what the gateway, the checkout and the landing page must agree on,
--  and the catalog says 100M/day. Keeping two budget shapes in one column
--  is exactly how this bug happened; one shape, one meaning.
--
--  SAFETY. Renewal already flips `daily_quota` to TRUE (billing/service.ts
--  `subscription.activated`), so this only brings the remaining rows
--  forward to the state they would reach at their next renewal. Measured
--  impact at the time of writing: today's usage for every affected org is
--  a few hundred thousand tokens against a 100M daily budget — nobody is
--  cut by this change, and two orgs (Youssef, frontier) regain access they
--  had already lost.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Every live subscription sums over the Tunis day ────────────────
UPDATE subscriptions
   SET daily_quota = TRUE
 WHERE daily_quota = FALSE;

-- ── 2. Guard: no plan may carry a budget in the wrong unit ────────────
-- A plan served on the daily window MUST have a per-day budget for every
-- alias it serves. A missing entry reads as "unlimited" in the wall
-- (fail-open by design), which would hand a customer an unbounded
-- allowance instead of 100M — the opposite failure, and equally silent.
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || ':' || m) INTO bad
    FROM plans p, unnest(p.models) AS m
   WHERE p.public = TRUE
     AND (p.token_limits ->> m) IS NULL;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0029: served alias without a daily token budget: %', array_to_string(bad, ', ');
  END IF;
END $$;

-- ── 3. Guard: the shipped plans are exactly 100M/day per alias ────────
DO $$
DECLARE
  bad text[];
BEGIN
  SELECT array_agg(p.code || ':' || m || '=' || (p.token_limits ->> m)) INTO bad
    FROM plans p, unnest(p.models) AS m
   WHERE p.code IN ('starter', 'pro', 'trial')
     AND (p.token_limits ->> m)::bigint <> 100000000;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      '0029: shipped plan budget is not 100M/day: %', array_to_string(bad, ', ');
  END IF;
END $$;
