-- ═══════════════════════════════════════════════════════════════════════
--  0010_model_tiers.sql — serve `fast` / `smart` / `frontier`
--
--  The gateway now runs THREE aliases over ELEVEN deployments instead of
--  one alias over one deployment (HANDOFF.md §5.25). Two things follow from
--  that, and this migration does the first of them.
--
--  1. PLAN ALLOWLISTS. `plans.models` is the gate a key is minted against
--     (portal/lib/keys/policy.ts, exact match, aliases only — never an
--     upstream id). 0003 deliberately set it to ARRAY['fast'] with the
--     note: "a plan that advertises `smart` would hand out 404s." That
--     caveat is now obsolete — `smart` and `frontier` both exist — so the
--     allowlists would otherwise leave two thirds of the fleet
--     unreachable to every customer.
--
--     Starter gets fast + smart. Pro adds frontier.
--
--     NOTE this widens, never narrows. Keys already minted keep whatever
--     models they were issued with and nothing an existing key could do
--     becomes invalid. Existing ORGS, however, keep a CACHED allowlist in
--     `entitlements` — see the refresh step below, without which they would
--     keep refusing `smart` for up to an hour.
--
--  2. THE REASON TIERS EXIST is billing, and it is worth stating because
--     the alternative was rejected: with one alias, every request bills at
--     one rate and a customer cannot express "cheap for bulk, expensive
--     for the hard bits". Distinct nominal rates per tier make a frontier
--     budget behave differently from a fast one, which is what keeps the
--     budget path exercisable under real traffic.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Starter: fast + smart ────────────────────────────────────────────
-- `frontier` is held back deliberately. Its nominal rate is 4x `fast`, so
-- putting it on the lowest tier would let a $19/month plan burn its
-- included spend in a quarter of the calls. That is a pricing decision,
-- not a technical one — it belongs to whoever owns the pricing, not here.
UPDATE plans SET
  models = ARRAY['fast', 'smart'],
  updated_at = now()
WHERE code = 'starter';

-- ── Pro: all three ───────────────────────────────────────────────────
UPDATE plans SET
  models = ARRAY['fast', 'smart', 'frontier'],
  updated_at = now()
WHERE code = 'pro';

-- ── Refresh the cached entitlement snapshot ───────────────────────────
--
-- CRITICAL, and missed by the first draft of this migration.
-- `planForOrg()` does NOT read `plans` directly: it reads the per-org
-- `entitlements` row first and only falls back to the live subscription
-- (portal/lib/keys/store.ts). So widening `plans.models` changes NOTHING for
-- an org that already has a cached entitlement — it keeps serving the old
-- allowlist until something re-syncs it.
--
-- The `reconcile-entitlements` backstop eventually does that, but its
-- BACKSTOP_INTERVAL_MINUTES is 60: a paying customer whose plan now
-- includes `smart` would get "Model \"smart\" is not included in your plan"
-- for up to an hour after a successful deploy. That is the exact confusion
-- this migration is supposed to end.
--
-- So force every cached row due right now. The job then refreshes all of
-- them on its next pass (seconds away) instead of an hour away.
--
-- `synced_at` is moved back rather than deleted, and `status` is left
-- alone: setting status='pending' would make the row look like a FAILED
-- sync to the admin console and to the retry queue, which is a lie — the
-- last sync succeeded, it is just stale. The backstop selects on
-- synced_at, so that alone is enough.
UPDATE entitlements
   SET synced_at = synced_at - INTERVAL '2 hours'
 WHERE synced_at IS NOT NULL;

-- ── Guard: no plan may advertise an alias the gateway does not serve ──
-- A typo here is silent and expensive: the plan advertises a model, the
-- portal mints a key scoped to it, and every request 403s with
-- "not available for this API key" — a message that points at the key,
-- not at the catalog. There is no application-level check for this, so
-- this migration asserts it at the only layer that sees both sides.
DO $$
DECLARE
  served text[] := ARRAY['fast', 'smart', 'frontier'];
  bad    text[];
BEGIN
  SELECT array_agg(m)
    INTO bad
    FROM plans, unnest(models) AS m
   WHERE m <> ALL (served);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'plans.models references aliases the gateway does not serve: %', bad;
  END IF;
END $$;
