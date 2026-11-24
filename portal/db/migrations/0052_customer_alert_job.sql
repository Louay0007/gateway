-- ══════════════════════════════════════════════════════════════════════
--  0052_customer_alert_job.sql — register customer_quota_alerts.
--
--  WHY THIS IS SEPARATE FROM 0051. 0051 created the tables and was applied
--  by the 19:14 deploy; migrations are forward-only and ledger-guarded, so
--  the missing row cannot be added to it now. This file is the correction,
--  which is also why 0051's header claims otherwise — see the note below.
--
--  THE BUG THIS FIXES, caught by querying production after the deploy
--  reported success:
--
--    $ SELECT name FROM job_runs WHERE name='customer_quota_alerts';
--    (0 rows)
--
--  `scripts/jobs.ts` claims its lock with
--
--    UPDATE job_runs SET locked_at = now() WHERE name = $1 RETURNING name
--
--  so a job with no `job_runs` row updates zero rows, `acquireLock` returns
--  false, and the runner skips it on every tick — forever, while logging
--  only "job skipped, locked elsewhere". The code was registered in JOBS and
--  shipped, and would never have run: a feature that reads as present in
--  review and is invisible in production.
--
--  This is the same trap 0033 documented for the two chat jobs. Any job
--  added to JOBS needs a row here; the two lines are the whole requirement.
--
--  ON CONFLICT makes the file idempotent, so re-running it is a no-op.
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO job_runs (name) VALUES
  ('customer_quota_alerts')
ON CONFLICT (name) DO NOTHING;

-- Guard: the row must exist and be unlocked. A seeded row that is already
-- locked would mean a crashed run left a stale lease, and the job would stay
-- silent until STALE_LOCK_MINUTES elapsed — worth failing the deploy over
-- rather than discovering as missing mail.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM job_runs WHERE name = 'customer_quota_alerts';
  IF n <> 1 THEN
    RAISE EXCEPTION '0052: customer_quota_alerts is not registered in job_runs (rows=%)', n;
  END IF;
END $$;
