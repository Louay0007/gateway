-- ═══════════════════════════════════════════════════════════════════════
--  0003_mvp_plans_and_billing.sql — MVP scope cut (2026-10-11)
--
--  Three decisions collapsed the original four-plan, Stripe-shaped design
--  into the MVP:
--
--    1. Individual users only  — no teams, invites, seats or trials.
--    2. Two plans: Starter and Pro. No free tier: a new account lands in
--       "choose a plan" and cannot mint keys until a subscription is live
--       (the paywall state — provisioning no longer seeds a subscription).
--    3. Subscriptions are provider-agnostic. The payment provider is being
--       finalised (referred to internally as "D17"); until it is, a dev
--       provider exercises the identical lifecycle. So every Stripe-named
--       column, table, enum value and job goes provider-neutral NOW,
--       while the rename is cheap, rather than after money moves.
--
--  Everything here is FORWARD-ONLY; 0001/0002 are never edited.
--
--  The DELETEs below are scoped to rows that reference the REMOVED plans
--  (free, business). Any Starter/Pro subscription, its org, keys, ledger
--  rows and entitlement survive untouched. Today the dev database holds
--  only free-plan test rows, so in practice this empties it — that is
--  the intended pre-launch cleanup, and the metering proof re-creates
--  everything it needs on demand.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Plan catalog: free + business out, starter + pro retuned ───────
-- FKs point at plans from subscriptions, entitlements and usage_periods,
-- so children go first. usage_records references organizations (not
-- plans) and is left alone: the ledger is append-only evidence.

DELETE FROM subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code IN ('free','business'));
DELETE FROM entitlements WHERE plan_id IN (SELECT id FROM plans WHERE code IN ('free','business'));
DELETE FROM usage_periods WHERE plan_id IN (SELECT id FROM plans WHERE code IN ('free','business'));
DELETE FROM plans        WHERE code IN ('free','business');

-- The free-plan invariant is dead with the free plan: the DB no longer
-- needs to defend a tier that cannot exist. Left in place it would only
-- mislead the next reader into thinking a free tier is coming back.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS free_plan_no_spend;

-- Starter / Pro, MVP shape. Numbers per PLATFORM.md §4.2 (illustrative —
-- replace included_spend_cents with true COGS × 1.3 before charging real
-- money). Both plans serve only `fast`: it is the only model the gateway
-- deploys, and a plan that advertises `smart` would hand out 404s.
-- trials = 0 everywhere: the trial machinery is deferred past MVP.
UPDATE plans SET
  price_cents              = 1900,
  description              = 'For individuals shipping their first integration.',
  included_spend_cents     = 2000,
  overage_markup_bps       = 3000,
  hard_cap_cents           = 10000,
  rpm_limit                = 60,
  tpm_limit                = 200000,
  max_concurrent_requests  = 5,
  max_keys                 = 3,
  max_seats                = 1,
  rate_multiplier_bps      = 13000,
  models                   = ARRAY['fast'],
  trial_days               = 0,
  features                 = '{"history_days":90,"exports":false}'::jsonb,
  updated_at               = now()
WHERE code = 'starter';

UPDATE plans SET
  price_cents              = 9900,
  description              = 'For production traffic and higher limits.',
  included_spend_cents     = 18000,
  overage_markup_bps       = 2500,
  hard_cap_cents           = 60000,
  rpm_limit                = 300,
  tpm_limit                = 1500000,
  max_concurrent_requests  = 20,
  max_keys                 = 15,
  max_seats                = 1,
  rate_multiplier_bps      = 12500,
  models                   = ARRAY['fast'],
  trial_days               = 0,
  features                 = '{"history_days":365,"exports":false}'::jsonb,
  updated_at               = now()
WHERE code = 'pro';

-- ── 2. Billing is provider-agnostic ───────────────────────────────────
-- Renames only — no type changes. api_keys.litellm_key_name stays: it is
-- the gateway's handle, not the payment provider's.

ALTER TABLE plans RENAME COLUMN stripe_price_id TO provider_price_id;

ALTER TABLE subscriptions RENAME COLUMN stripe_customer_id        TO provider_customer_id;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id    TO provider_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN last_stripe_event_id      TO last_provider_event_id;
ALTER TABLE subscriptions RENAME COLUMN last_stripe_event_at      TO last_provider_event_at;
ALTER TABLE usage_periods  RENAME COLUMN stripe_metered_at        TO provider_metered_at;

ALTER TABLE stripe_events RENAME TO billing_events;
ALTER INDEX  stripe_events_unprocessed_idx RENAME TO billing_events_unprocessed_idx;

-- Audit actors: the payer is "the provider", not one named company.
-- Requires PostgreSQL 10+ (RENAME VALUE); we run 16.
ALTER TYPE audit_actor RENAME VALUE 'stripe' TO 'provider';

-- ── 3. Jobs: the three the MVP runs ──────────────────────────────────
-- collect_usage, rollup_usage, reconcile_entitlements stay (seeded by
-- 0001). The other four belong to deferred work (Stripe meters, trials,
-- cost re-pricing, anomaly alerts) and must not sit in the schedule
-- table pretending they exist.
DELETE FROM job_runs WHERE name IN
  ('push_meters','expire_trials','reconcile_costs','detect_anomalies');

-- ── 4. Backfill the ledger's key attribution ──────────────────────────
-- The collector has written NULL api_key_id since day one (it only knew
-- the gateway's token hash). Match on that hash — the identifier that
-- survived the mask/token fix — and fill what is knowable. Rows whose
-- key was revoked still resolve: the FK is ON DELETE SET NULL, so the
-- link outlives the key, which is exactly what a dispute response needs.
UPDATE usage_records ur
   SET api_key_id = ak.id
  FROM api_keys ak
 WHERE ur.api_key_id IS NULL
   AND ur.upstream_key_hash IS NOT NULL
   AND ak.litellm_key_hash = ur.upstream_key_hash;
