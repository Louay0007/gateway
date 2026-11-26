-- ══════════════════════════════════════════════════════════════════════════
--  0055_subscription_removal.sql — who ended it, and why
--
--  WHY THIS IS NOT A DELETE, and why it never will be.
--
--  `payments_d17.subscription_id` and `trial_redemptions.subscription_id`
--  are both `ON DELETE CASCADE`. Deleting a subscription would delete its
--  payment rows with it — the evidence that money arrived. A customer
--  disputing a charge would leave us unable to show they paid, and the
--  audit trail would point at a subscription id that no longer resolves.
--
--  That is the same class of loss `staff_users.revoked_at` exists to
--  prevent (0015): revocation is a column, not a DELETE, because the
--  credit notes and audit rows name the row being revoked.
--
--  So an operator "removes" a subscription by moving its STATUS, and the
--  three columns below record that a HUMAN did it, when, and why. That
--  distinction matters at reconciliation time: "cancelled by the customer"
--  and "removed by ops because of a chargeback" are different facts and
--  must not look identical in the ledger.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS removed_at      TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS removed_by      TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS removal_reason  TEXT;

COMMENT ON COLUMN subscriptions.removed_at IS
  'Set when an OPERATOR removed the subscription (0055). NULL = customer action, or still live.';
COMMENT ON COLUMN subscriptions.removed_by IS
  'staff_users.id of the operator. Never a customer — this column is only written from the console.';
COMMENT ON COLUMN subscriptions.removal_reason IS
  'Required free text. Ending a paying customer''s service early must be explicable.';

-- "What have we removed recently" — a review surface, not a hot path, but
-- one that would otherwise scan the whole table.
CREATE INDEX IF NOT EXISTS subscriptions_removed_idx
  ON subscriptions (removed_at DESC)
  WHERE removed_at IS NOT NULL;
