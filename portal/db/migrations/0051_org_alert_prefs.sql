-- ══════════════════════════════════════════════════════════════════════
--  0051_org_alert_prefs.sql — tell the customer before the 403 does.
--
--  WHY. `send_alerts` detects collector lag, failed entitlements and job
--  errors, and mails OPS_ALERT_EMAIL. Nothing told the CUSTOMER anything.
--  A customer learned they were out of tokens when a request returned
--  "Out of tokens for this period" — which is the single most common way a
--  metered product loses someone's trust: the first warning is the failure.
--
--  WHAT THIS TABLE HOLDS, and what it deliberately does not:
--
--    thresholds   int[]  — percentages of the period pool at which to mail.
--                          Default {80,95}; empty = no threshold mail.
--    channel      text   — 'email' | 'none'. One value today; the column
--                          exists so adding a second channel is a value, not
--                          a migration.
--    on_exhausted bool   — mail when the pool is actually spent.
--    on_anomaly   bool   — mail when one call costs an unusual amount.
--
--  WHY A SEPARATE TABLE AND NOT COLUMNS ON `organizations`: the orgs table
--  is read on every request (`requireActiveOrg`); these are read by one job
--  every 15 minutes. Putting them together would widen the hot path for a
--  preference nobody on it needs.
--
--  WHY A SENT LEDGER AND NOT JUST THE PREFS. "Mail at 80%" is not
--  idempotent by itself: the job runs every 15 minutes, so a customer at
--  83% would be mailed four times an hour until they hit 95%. The ledger
--  records (org, period, threshold) once, which is what makes "exactly one
--  mail per threshold per period" true rather than hoped for.
--
--  NO ROW = DEFAULTS. An org that never opened the settings tab has no row,
--  and the job treats that as {80,95}, email, on_exhausted, no anomaly mail
--  — so this ships opt-out-with-a-safe-default rather than opt-in-empty,
--  which is the difference between a feature that helps and one that is
--  never discovered.
--
--  NOTE: this file does NOT register the job in `job_runs`, and it must
--  have. `acquireLock` is an UPDATE keyed on that row, so an unregistered
--  job never runs while logging only "job skipped". 0052 does the insert.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_alert_prefs (
  organization_id       UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- Percentages, not token counts: a budget change must not silently move
  -- the alert to a different fraction of the pool.
  quota_thresholds      INT[]      NOT NULL DEFAULT ARRAY[80, 95],
  channel               TEXT       NOT NULL DEFAULT 'email',
  on_exhausted          BOOLEAN    NOT NULL DEFAULT TRUE,
  on_anomaly            BOOLEAN    NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT org_alert_prefs_channel_check
    CHECK (channel IN ('email', 'none')),
  -- A threshold outside 1..100 is a typo, and a 0 or a 140 would either
  -- fire immediately on every pass or never fire at all. Reject both at the
  -- data layer rather than trusting every writer.
  --
  -- NO SUBQUERY: Postgres rejects `NOT EXISTS (SELECT … unnest(…))` inside a
  -- CHECK ("cannot use subquery in check constraint"). This is the equivalent
  -- with array operators, verified against the live database:
  --
  --   {80,95}  passes · {1,100} passes · {0} fails · {101} fails · {} fails
  --
  -- `ALL` on an empty array is vacuously true, so `cardinality(...) >= 1` is
  -- what rejects an empty list — without it, `channel='email'` with no
  -- thresholds would be accepted and silently never mail.
  CONSTRAINT org_alert_prefs_thresholds_check
    CHECK (
      quota_thresholds IS NOT NULL
      AND cardinality(quota_thresholds) BETWEEN 1 AND 5
      AND 1 <= ALL (quota_thresholds)
      AND 100 >= ALL (quota_thresholds)
    )
);

COMMENT ON TABLE org_alert_prefs IS
  'Per-org quota notification preferences. No row = the defaults in the column declarations.';

-- Which (org, period, threshold) mails have already gone out. The primary
-- key IS the idempotency guarantee: a second insert for the same triple is
-- a no-op, so a job that runs every 15 minutes cannot send four copies.
CREATE TABLE IF NOT EXISTS org_alert_sent (
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The subscription period the threshold belongs to, so the next period
  -- starts clean without deleting anything.
  period_start     TIMESTAMPTZ NOT NULL,
  threshold        INT         NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, period_start, threshold)
);

COMMENT ON TABLE org_alert_sent IS
  'One row per org/period/threshold already mailed. The primary key is the dedupe.';

CREATE INDEX IF NOT EXISTS org_alert_sent_period_idx
  ON org_alert_sent (period_start);

-- Guard 1: the CHECK actually rejects what it claims to.
--
-- The first version of this file used a subquery inside the CHECK and was
-- rejected by Postgres at deploy time (`cannot use subquery in check
-- constraint`), so the deploy failed after 0050 with nothing applied. This
-- block proves the replacement expression on the database that will run it,
-- so a future edit that "simplifies" the constraint fails here rather than
-- in production.
--
-- The expression is evaluated into a BOOLEAN first: PL/pgSQL's `IF` takes a
-- condition, not an expression in parentheses, so inlining the arithmetic
-- raises a syntax error at parse time.
DO $$
DECLARE
  ok boolean;
BEGIN
  ok := cardinality(ARRAY[80,95]) BETWEEN 1 AND 5
        AND 1 <= ALL (ARRAY[80,95]) AND 100 >= ALL (ARRAY[80,95]);
  IF NOT ok THEN
    RAISE EXCEPTION '0051: the threshold expression rejects the defaults';
  END IF;

  ok := cardinality(ARRAY[0]) BETWEEN 1 AND 5
        AND 1 <= ALL (ARRAY[0]) AND 100 >= ALL (ARRAY[0]);
  IF ok THEN
    RAISE EXCEPTION '0051: the threshold expression accepts 0';
  END IF;

  ok := cardinality(ARRAY[101]) BETWEEN 1 AND 5
        AND 1 <= ALL (ARRAY[101]) AND 100 >= ALL (ARRAY[101]);
  IF ok THEN
    RAISE EXCEPTION '0051: the threshold expression accepts 101';
  END IF;

  ok := cardinality('{}'::int[]) BETWEEN 1 AND 5;
  IF ok THEN
    RAISE EXCEPTION '0051: the threshold expression accepts an empty list';
  END IF;
END $$;

-- Guard 2: the column's stored DEFAULT must be the value the job documents.
--
-- Read from `pg_attrdef`, not from `SELECT … FROM org_alert_prefs LIMIT 1`:
-- on a fresh table that returns no row, so the earlier version of this guard
-- asserted nothing at all. `pg_get_expr` yields the expression source
-- (`ARRAY[80, 95]`), which has to be cast to the column type before it can
-- be compared — an uncast assignment fails with
-- `malformed array literal: "ARRAY[80, 95]"`.
DO $$
DECLARE
  expr text;
  def  int[];
BEGIN
  SELECT pg_get_expr(adbin, adrelid)::text
    INTO expr
    FROM pg_attrdef
   WHERE adrelid = 'org_alert_prefs'::regclass
     AND adnum = (
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'org_alert_prefs'::regclass
          AND attname = 'quota_thresholds'
     );

  IF expr IS NULL THEN
    RAISE EXCEPTION '0051: quota_thresholds has no default';
  END IF;

  EXECUTE format('SELECT (%s)::int[]', expr) INTO def;

  IF def IS DISTINCT FROM ARRAY[80, 95] THEN
    RAISE EXCEPTION '0051: unexpected default thresholds % (from %)', def, expr;
  END IF;
END $$;
