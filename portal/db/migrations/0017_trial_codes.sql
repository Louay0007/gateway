-- 0017: Free trial codes and redemptions
-- Supports time-limited promotional trial codes (e.g. social media campaigns).
-- Each code grants a fixed-duration trial with capped prompt limits on fast+smart.

CREATE TABLE trial_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  created_by      TEXT NOT NULL DEFAULT 'system',
  max_redemptions INTEGER NOT NULL DEFAULT 0,          -- 0 = unlimited
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  models          TEXT[] NOT NULL DEFAULT ARRAY['fast','smart'],
  prompt_limits   JSONB NOT NULL DEFAULT '{"fast":300,"smart":300}',
  trial_days      INTEGER NOT NULL DEFAULT 3,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_until     TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,                -- hard cutoff for ALL trials from this code
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trial_codes_active_idx ON trial_codes(active, valid_from, valid_until);

CREATE TABLE trial_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_code_id   UUID NOT NULL REFERENCES trial_codes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE(organization_id, trial_code_id)               -- one redemption per org per code
);

CREATE INDEX trial_redemptions_org_idx ON trial_redemptions(organization_id);
CREATE INDEX trial_redemptions_expiry_idx ON trial_redemptions(expires_at);

-- Seed the October 2026 launch trial code
INSERT INTO trial_codes (code, created_by, max_redemptions, models, prompt_limits, trial_days, valid_from, valid_until, expires_at)
VALUES (
  'ZAINO-FREE-OCT26',
  'system',
  0,                                          -- unlimited redemptions
  ARRAY['fast','smart'],
  '{"fast":300,"smart":300}'::jsonb,          -- 300 total per model across 3 days
  3,
  '2026-10-20T00:00:00+01:00',
  '2026-10-22T23:59:59+01:00',
  '2026-10-22T23:59:59+01:00'
);

-- Seed a hidden trial plan (not visible on pricing page)
INSERT INTO plans (code, name, description, public, sort_order, price_cents, interval,
                   included_spend_cents, overage_markup_bps, hard_cap_cents,
                   rpm_limit, tpm_limit, max_concurrent_requests, max_keys, max_seats,
                   rate_multiplier_bps, models, trial_days, prompt_limits, features)
VALUES (
  'trial',
  'Free Trial',
  '3-day trial with 300 requests on Sonnet 5 and Opus 5.5.',
  FALSE,
  -1,
  0,
  'month',
  0,
  0,
  0,
  10,
  50000,
  2,
  1,
  1,
  10000,
  ARRAY['fast','smart'],
  3,
  '{"fast":300,"smart":300}'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

-- Seed the job_runs ledger row so the scheduler picks up expire_trials.
-- The jobs loop only runs jobs that are BOTH in the JOBS array AND in this
-- table; without this row the trial expiry job silently never fires.
INSERT INTO job_runs (name, last_run_at, locked_at, attempts, last_error)
VALUES ('expire_trials', NULL, NULL, 0, NULL)
ON CONFLICT (name) DO NOTHING;