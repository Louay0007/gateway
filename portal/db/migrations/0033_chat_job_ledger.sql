-- ─────────────────────────────────────────────────────────────────────
--  0033_chat_job_ledger.sql
--
--  Register the two chat jobs in the `job_runs` ledger.
--
--  WHY THIS IS A NEW FILE AND NOT A FIX TO 0031.
--  0031 seeds these two rows at its section 10, but that INSERT was added
--  to the file AFTER 0031 had already been recorded in `schema_migrations`
--  (2026-11-03 00:30). scripts/db-migrate.sh skips by NAME and never
--  re-reads an applied file, so on the production cluster the schema parts
--  of 0031 landed and this seed never did.
--
--  That is a silent failure, not a cosmetic one: the lock for a job IS its
--  row in `job_runs`, so `acquireLock` runs
--
--      UPDATE job_runs SET locked_at = now() WHERE name = $1 ...
--
--  against a name that does not exist, matches zero rows, returns false,
--  and the runner logs:
--
--      {"level":"info","msg":"job skipped, locked elsewhere",
--       "job":"run_schedules"}
--
--  once a minute, forever. Nothing is locked. The consequence was that
--  scheduled prompts never fired and temporary chats were never purged.
--
--  Editing 0031 in place would have "fixed" the repo while leaving every
--  already-migrated cluster broken, which is the trap this file exists to
--  avoid. Applying it twice is still a no-op: the ledger is keyed by name
--  so the runner will not re-execute it, and ON CONFLICT guards the rows.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO job_runs (name) VALUES
  ('run_schedules'),
  ('enforce_retention')
ON CONFLICT (name) DO NOTHING;
