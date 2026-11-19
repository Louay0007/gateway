-- 0050: D17 automatic proof verification — the ledger an auto-approval leaves behind
--
-- WHY A TABLE AND NOT A COLUMN. An auto-approval moves real money without a
-- human reading the screenshot. The only thing that makes that defensible
-- afterwards is a record of exactly what the agent saw and what it decided,
-- on the row it decided about — not a log line that rotates away and not an
-- audit row whose shape every other action shares. This table is the evidence
-- a chargeback dispute or a reconciliation review reads.
--
-- ONE ROW PER ATTEMPT, not one per payment. An agent that reads a blurry
-- screenshot, refuses, and is re-run after the customer re-uploads is two
-- attempts. Keeping both makes "the first read disagreed with the second"
-- visible, which is itself a signal that the proof is worth a human look.
--
-- The decision is recorded INDEPENDENTLY of the payment's status. A row here
-- saying `verdict = 'pass'` next to a payment still in `proof_submitted`
-- is the signature of an approval that was attempted and failed — the exact
-- case staff must be able to find.

CREATE TYPE d17_verify_verdict AS ENUM ('pass', 'review', 'fail');

CREATE TABLE payments_d17_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            UUID NOT NULL REFERENCES payments_d17(id) ON DELETE CASCADE,

  -- Which model read the image and under which prompt. "The agent approved
  -- it" is unreviewable without both: a prompt change is a decision change.
  model                 TEXT        NOT NULL,
  prompt_version        TEXT        NOT NULL,

  -- What the reader claims it saw, stored verbatim. NULL means "could not
  -- read this field", never "absent" — the distinction is the difference
  -- between a refused screenshot and a forged one.
  extracted_amount      TEXT,
  extracted_auth_number TEXT,
  extracted_phone       TEXT,
  extracted_receiver    TEXT,
  extracted_date        TEXT,

  -- The comparison, field by field, so a human disagreeing with the verdict
  -- can see which field the agent got wrong rather than only the total.
  -- Example: {"amount":"match","auth":"match","phone":"mismatch",...}
  checks                JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- 0-100. Stored as an integer because a float score implies a precision
  -- this signal does not have, and someone will eventually threshold it.
  score                 SMALLINT    NOT NULL CHECK (score BETWEEN 0 AND 100),
  verdict               d17_verify_verdict NOT NULL,

  -- The model's own one-line justification. Rendered in the queue so staff
  -- read a reason, not a number.
  reason                TEXT,

  -- True only when this row's verdict actually flipped the payment to paid.
  approved              BOOLEAN     NOT NULL DEFAULT false,
  -- Why approval was withheld despite a passing verdict (flagged_review,
  -- amount out of tolerance, ...). NULL when nothing blocked it.
  blocked_by            TEXT,

  -- Token cost of the read, so the campaign's cost is measurable rather
  -- than estimated. Nullable: the gateway reports usage separately.
  input_tokens          INT,
  output_tokens         INT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The queue reads "latest attempt per payment"; this serves it.
CREATE INDEX payments_d17_verifications_payment_idx
  ON payments_d17_verifications (payment_id, created_at DESC);

-- "What did the agent approve this week, and did anyone disagree with it?"
CREATE INDEX payments_d17_verifications_approved_idx
  ON payments_d17_verifications (created_at DESC)
  WHERE approved IS TRUE;

-- Guard: an approved row must carry a passing verdict and no blocker.
-- The inverse — pass + blocked — is legal and is the whole point of the
-- column. A row that claims it approved a payment without a pass would
-- make this table lie about the only thing it is here to prove.
ALTER TABLE payments_d17_verifications
  ADD CONSTRAINT payments_d17_verifications_approved_shape
  CHECK (
    approved IS FALSE
    OR (verdict = 'pass' AND blocked_by IS NULL)
  );
