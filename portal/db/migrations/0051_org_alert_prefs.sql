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
  CONSTRAINT org_alert_prefs_thresholds_check
    CHECK (
      quota_thresholds IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(quota_thresholds) AS t
         WHERE t < 1 OR t > 100
      )
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

-- Guard: the defaults must be the values the job documents. A migration
-- that quietly changed the default to {0} would mail every org on every
-- pass, which is worse than no alerts at all.
DO $$
DECLARE
  d int[];
BEGIN
  SELECT quota_thresholds INTO d
    FROM org_alert_prefs
   LIMIT 1;

  -- No rows yet is the normal case on first deploy.
  IF d IS NOT NULL AND d <> ARRAY[80, 95] THEN
    RAISE EXCEPTION '0051: unexpected default thresholds %', d;
  END IF;
END $$;
