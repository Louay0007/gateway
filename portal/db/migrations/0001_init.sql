-- ═══════════════════════════════════════════════════════════════════════
--  0001_init.sql — portal database
--
--  This database is OURS. The gateway's `litellm` database is separate and
--  is never touched with SQL — the portal talks to LiteLLM over REST only.
--  See PLATFORM.md §1.1.
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ── auth mirror ─────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider TEXT        NOT NULL CHECK (auth_provider IN ('clerk','authjs')),
  auth_id       TEXT        NOT NULL,
  email         CITEXT      NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_provider_auth_id_key UNIQUE (auth_provider, auth_id)
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- ── organizations ──────────────────────────────────────────────────
CREATE TYPE org_status AS ENUM ('active','suspended','deleted');

CREATE TABLE organizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  status           org_status  NOT NULL DEFAULT 'active',

  -- Which legal model are we operating under? See PLATFORM.md §0.
  -- 'platform' = we hold the upstream key (resale — needs written approval)
  -- 'byok'     = customer holds their own key (we sell software)
  key_ownership    TEXT        NOT NULL DEFAULT 'platform'
                     CHECK (key_ownership IN ('platform','byok')),

  -- Model B only. Ciphertext at rest; NEVER logged, never returned by API.
  byok_provider    TEXT,
  byok_ciphertext  BYTEA,
  byok_last4       TEXT,

  litellm_team_id  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX organizations_status_idx
  ON organizations (status) WHERE status <> 'deleted';

CREATE TYPE org_role AS ENUM ('owner','admin','developer','billing','viewer');

CREATE TABLE organization_members (
  organization_id  UUID     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID     NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role             org_role NOT NULL DEFAULT 'developer',
  litellm_user_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- Staff are NOT org members. Separate table so a staff account can never
-- authenticate as a customer. See PLATFORM.md §8.5.
CREATE TABLE staff_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT   NOT NULL UNIQUE,
  name        TEXT,
  role        TEXT     NOT NULL DEFAULT 'support'
                CHECK (role IN ('owner','admin','support','read_only')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── plan catalog ───────────────────────────────────────────────────
CREATE TYPE plan_interval AS ENUM ('month','year');

CREATE TABLE plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT           NOT NULL UNIQUE,
  name                     TEXT           NOT NULL,
  description              TEXT,
  public                   BOOLEAN        NOT NULL DEFAULT true,
  sort_order               INT            NOT NULL DEFAULT 0,

  stripe_price_id          TEXT UNIQUE,   -- NULL for free

  price_cents              INT            NOT NULL DEFAULT 0,
  interval                 plan_interval  NOT NULL DEFAULT 'month',

  -- Entitlement template. Every number that becomes a LiteLLM limit.
  included_spend_cents     INT            NOT NULL DEFAULT 0,
  overage_markup_bps       INT            NOT NULL DEFAULT 3000,
  hard_cap_cents           INT,                         -- NULL = unlimited
  rpm_limit                INT,
  tpm_limit                INT,
  max_concurrent_requests  INT,
  max_keys                 INT            NOT NULL DEFAULT 1,
  max_seats                INT            NOT NULL DEFAULT 1,
  rate_multiplier_bps      INT            NOT NULL DEFAULT 10000,
  models                   TEXT[]         NOT NULL DEFAULT '{}',
  trial_days               INT            NOT NULL DEFAULT 0,
  features                 JSONB          NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- A free plan must never authorise spend. This is the fraud control
  -- in PLATFORM.md §9.1 — enforce it in the database, not just the app.
  CONSTRAINT free_plan_no_spend
    CHECK (code <> 'free' OR (included_spend_cents = 0
                              AND (hard_cap_cents IS NULL OR hard_cap_cents = 0)))
);

-- ── subscriptions ──────────────────────────────────────────────────
CREATE TYPE sub_status AS ENUM
  ('trialing','active','past_due','canceled','unpaid','paused','incomplete');

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                UUID NOT NULL REFERENCES plans(id),
  status                 sub_status NOT NULL,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  trial_end              TIMESTAMPTZ,
  last_stripe_event_id   TEXT,
  last_stripe_event_at   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_org_idx   ON subscriptions (organization_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);

-- One live subscription per org. Enforced by the database so a race in
-- application code cannot create two.
CREATE UNIQUE INDEX subscriptions_one_live_idx
  ON subscriptions (organization_id)
  WHERE status IN ('trialing','active','past_due','paused');

-- ── entitlements (derived, single-writer) ──────────────────────────
CREATE TYPE sync_status AS ENUM ('pending','synced','failed');

CREATE TABLE entitlements (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL REFERENCES plans(id),
  plan_code       TEXT NOT NULL,
  effective       JSONB NOT NULL,
  status          sync_status NOT NULL DEFAULT 'pending',
  synced_at       TIMESTAMPTZ,
  last_error      TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entitlements_failed_idx
  ON entitlements (next_retry_at) WHERE status <> 'synced';

-- ── api keys ───────────────────────────────────────────────────────
CREATE TABLE api_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by         UUID NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,

  -- Display prefix only. The full key is returned exactly once at
  -- creation and never persisted in recoverable form.
  key_prefix         TEXT NOT NULL,
  key_hash           TEXT NOT NULL,

  litellm_key_name   TEXT,
  litellm_key_hash   TEXT,

  revoked_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (organization_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX api_keys_litellm_name_idx
  ON api_keys (litellm_key_name) WHERE litellm_key_name IS NOT NULL;

-- ── usage ledger (append-only) ─────────────────────────────────────
CREATE TABLE usage_records (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id            UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  member_user_id        UUID REFERENCES users(id)   ON DELETE SET NULL,

  occurred_at           TIMESTAMPTZ NOT NULL,
  billing_period        DATE NOT NULL,

  model                 TEXT NOT NULL,
  route                 TEXT NOT NULL,
  upstream_key_hash     TEXT,

  input_tokens          INT NOT NULL DEFAULT 0,
  output_tokens         INT NOT NULL DEFAULT 0,
  cache_write_5m_tokens INT NOT NULL DEFAULT 0,
  cache_write_1h_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens     INT NOT NULL DEFAULT 0,
  latency_ms            INT,
  status_code           INT,

  -- Both stored, deliberately. The gap is your margin; storing only one
  -- makes the business invisible. See PLATFORM.md §3.3.
  cost_upstream_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,
  cost_customer_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,

  price_table_version   TEXT,
  dedupe_hash           TEXT NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The collector polls a window and will replay on any restart. This index
-- is what makes ingestion idempotent. PLATFORM.md §7.4.
CREATE UNIQUE INDEX usage_records_dedupe_idx    ON usage_records (dedupe_hash);
CREATE INDEX        usage_records_org_period_idx ON usage_records (organization_id, billing_period);
CREATE INDEX        usage_records_occurred_idx   ON usage_records (occurred_at);

CREATE TABLE usage_periods (
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  billing_period      DATE NOT NULL,
  plan_id             UUID NOT NULL REFERENCES plans(id),
  rate_multiplier_bps INT NOT NULL,

  requests            BIGINT NOT NULL DEFAULT 0,
  input_tokens        BIGINT NOT NULL DEFAULT 0,
  output_tokens       BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens   BIGINT NOT NULL DEFAULT 0,

  cost_upstream_usd   NUMERIC(14,8) NOT NULL DEFAULT 0,
  cost_customer_usd   NUMERIC(14,8) NOT NULL DEFAULT 0,

  stripe_metered_at   TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, billing_period)
);

-- ── operations ─────────────────────────────────────────────────────
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT
);
CREATE INDEX stripe_events_unprocessed_idx
  ON stripe_events (received_at) WHERE processed_at IS NULL;

CREATE TYPE audit_actor AS ENUM ('user','system','stripe');

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_type      audit_actor NOT NULL,
  actor_id        TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  before          JSONB,
  after           JSONB,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_time_idx ON audit_log (organization_id, created_at DESC);
CREATE INDEX audit_log_action_idx    ON audit_log (action, created_at DESC);

-- ── job runner (Postgres SKIP LOCKED; no Redis dependency) ─────────
CREATE TABLE job_runs (
  name        TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  locked_at   TIMESTAMPTZ,
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT
);

INSERT INTO job_runs (name) VALUES
  ('collect_usage'),
  ('rollup_usage'),
  ('push_meters'),
  ('expire_trials'),
  ('reconcile_entitlements'),
  ('reconcile_costs'),
  ('detect_anomalies');

-- ── seed plans ─────────────────────────────────────────────────────
-- ILLUSTRATIVE NUMBERS. Replace included_spend_cents with your true
-- upstream COGS × 1.3 before launch. See PLATFORM.md §4.2-4.3.
INSERT INTO plans
  (code, name, description, sort_order, price_cents, interval,
   included_spend_cents, overage_markup_bps, hard_cap_cents,
   rpm_limit, tpm_limit, max_concurrent_requests,
   max_keys, max_seats, rate_multiplier_bps, models, trial_days, features)
VALUES
  ('free','Free','Evaluate the API with no spend commitment.',
   0, 0, 'month',
   0, 3000, 0,
   10, 20000, 1,
   1, 1, 10000, ARRAY['fast'], 0,
   '{"history_days":7,"exports":false}'),

  ('starter','Starter','For individuals shipping their first integration.',
   1, 1900, 'month',
   2000, 3000, 10000,
   60, 200000, 5,
   3, 2, 13000, ARRAY['fast'], 7,
   '{"history_days":90,"exports":false}'),

  ('pro','Pro','For teams with production traffic and multiple models.',
   2, 9900, 'month',
   18000, 2500, 60000,
   300, 1500000, 20,
   15, 10, 12500, ARRAY['fast','smart'], 14,
   '{"history_days":365,"exports":true}'),

  ('business','Business','High volume, wide model access, audit controls.',
   3, 49900, 'month',
   100000, 2000, 500000,
   1200, 8000000, 80,
   100, 50, 12000, ARRAY['fast','smart'], 14,
   '{"history_days":730,"exports":true,"sso":true,"audit_api":true,"priority_support":true}');