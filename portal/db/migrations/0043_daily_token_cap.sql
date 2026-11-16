-- ══════════════════════════════════════════════════════════════════════
--  0043_daily_token_cap.sql — bound one day's spend inside a monthly pool.
--
--  WHY. The pool is monthly (0038/0039), so a customer can spend the whole
--  allowance before lunch. That is their right, but it is not a bounded
--  risk for the operator: one account with a 150M pool and a runaway agent
--  loop costs a month of margin in an hour, and the customer then spends
--  the rest of the period cut off, which is worse for them too.
--
--  A daily cap makes the worst case one day instead of one month. It does
--  NOT replace the pool: the pool is still the ceiling, and a customer who
--  never approaches either number never notices this column exists.
--
--  NULL / 0 = no daily cap (unlimited per day, still bounded by the pool).
--  Written as a plain bigint of blended tokens, the same unit as
--  token_limits, so nothing has to convert between two units.
--
--  THE NUMBERS, at the operator's measured cost of 0.20 DT per 1M units:
--    starter  3,000,000/day  ->  0.6 DT/day  -> 18 DT/month worst case
--    pro      8,000,000/day  ->  1.6 DT/day  -> 48 DT/month worst case
--  Both sit far below the monthly pool, so an ordinary heavy day is
--  untouched: a measured heavy dev-month is ~9.3M units, or ~420k/day.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS daily_token_cap bigint;

COMMENT ON COLUMN plans.daily_token_cap IS
  'Blended tokens per Tunis day. NULL or 0 = no daily cap (the monthly pool is the only limit).';

-- Backfill the shipped plans. A plan already carrying an explicit cap is
-- left alone, so re-running this file never overwrites a tuned value.
UPDATE plans SET daily_token_cap = 3000000
 WHERE code = 'starter' AND daily_token_cap IS NULL;
UPDATE plans SET daily_token_cap = 8000000
 WHERE code = 'pro' AND daily_token_cap IS NULL;
-- Trial: a QUARTER of its 1M pool. Setting the cap equal to the pool would
-- just be a renamed monthly limit — the point is that a day is a fraction.
UPDATE plans SET daily_token_cap = 250000
 WHERE code = 'trial' AND daily_token_cap IS NULL;
