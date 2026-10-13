-- ═══════════════════════════════════════════════════════════════════════
--  0005_d17_payments.sql — manual D17 (La Poste Tunisienne) payments
--
--  D17 has NO public merchant API and sends no webhooks: the merchant
--  confirms every transfer by hand in the app's transaction history.
--  This table is therefore a VERIFICATION QUEUE, not a payment record
--  the gateway wrote. The flow:
--
--    checkout → row created here (pending_payment, expires_at)
--            → customer transfers in the D17 app and submits the
--              authorization number (+ optional screenshot)
--            → admin verifies against the D17 app
--            → approve (subscription activates) or reject (customer
--              may resubmit once)
--
--  Two columns beyond the requested schema, both forced by requirements
--  in the same brief:
--    expires_at            — the payment-window deadline has to be
--                            stored to be displayed and auto-expired;
--                            deriving it from subscription timestamps
--                            would make a reused checkout row's window
--                            unknowable.
--    usd_amount_cents/fx_rate — reconciliation ("sum of approved vs
--                            D17 history") needs the rate the amount was
--                            computed with; the catalog prices in USD
--                            and D17 transfers in TND.
--
--  authorization_number is UNIQUE across ALL rows: one transfer must
--  never be able to pay two subscriptions. A duplicate insert is a
--  friendly error to the customer and an audit row for the admin.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TYPE d17_payment_status AS ENUM
  ('pending_payment','proof_submitted','paid','rejected','expired');

CREATE TABLE payments_d17 (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One payment row per subscription for its lifetime (resubmissions
  -- update it), which is what makes the FK unique.
  subscription_id      UUID NOT NULL UNIQUE REFERENCES subscriptions(id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  amount_millimes      INT  NOT NULL CHECK (amount_millimes > 0),
  currency             TEXT NOT NULL DEFAULT 'TND',
  usd_amount_cents     INT  NOT NULL,
  fx_rate              NUMERIC(10,4) NOT NULL,

  authorization_number TEXT UNIQUE,
  sender_phone         TEXT,
  screenshot_path      TEXT,
  status               d17_payment_status NOT NULL DEFAULT 'pending_payment',

  submitted_at         TIMESTAMPTZ,
  verified_at          TIMESTAMPTZ,
  verified_by          TEXT,               -- staff_users.id
  reject_reason        TEXT,
  flagged_review       BOOLEAN NOT NULL DEFAULT false,

  ip                   INET,
  user_agent           TEXT,

  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The proof shape: a pending payment has nothing submitted, and any
  -- submitted/decided payment has a number it came from. `expired` may
  -- carry neither — a payment nobody paid expires with no proof at all
  -- (which is the common case, and the one this constraint first got
  -- wrong). Enforced in the database because the application is one
  -- typo away from not doing it.
  CONSTRAINT payments_d17_proof_shape
    CHECK (
      (status IN ('pending_payment','expired') AND authorization_number IS NULL)
      OR (authorization_number IS NOT NULL AND sender_phone IS NOT NULL)
    )
);

CREATE INDEX payments_d17_queue_idx
  ON payments_d17 (submitted_at)
  WHERE status = 'proof_submitted';
CREATE INDEX payments_d17_sender_idx
  ON payments_d17 (sender_phone, submitted_at DESC);
CREATE INDEX payments_d17_expiry_idx
  ON payments_d17 (expires_at)
  WHERE status = 'pending_payment';

-- The audit trail is the EXISTING audit_log table (append-only, one
-- writer helper). No second log table: two logs diverge, and the one
-- nobody reads is the one that answers the dispute.
