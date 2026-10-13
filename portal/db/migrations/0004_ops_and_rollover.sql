-- ═══════════════════════════════════════════════════════════════════════
--  0004_ops_and_rollover.sql — alerting state + the rollover job
--
--  Two additions that complete the MVP backend:
--
--   1. `system_alerts` — the dedupe row for the ops alerting job.
--      One row, one state string: mail is sent when the state CHANGES,
--      never per pass, or the alerts get muted and the next real outage
--      is missed (PLATFORM.md §11).
--
--   2. `job_runs` rows for `expire_subscriptions` (honours
--      "cancel at period end") and `send_alerts` (the alerting pass).
--      A job is only active when registered in scripts/jobs.ts AND
--      present here; 0003 removed the rows for deferred work, and this
--      adds the two that are real.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_alerts (
  name         TEXT PRIMARY KEY,
  last_state   TEXT        NOT NULL,
  last_sent_at TIMESTAMPTZ
);

INSERT INTO job_runs (name) VALUES
  ('expire_subscriptions'),
  ('send_alerts')
ON CONFLICT (name) DO NOTHING;
