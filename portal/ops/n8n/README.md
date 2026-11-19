# D17 automatic proof verification

A customer pays by D17 (La Poste), uploads a screenshot and types an
authorization number. Today a staff member opens each screenshot, compares
the amount and the number by eye, and clicks approve. This replaces the eye.

An n8n workflow reads the queue every five minutes, sends each new
screenshot to a vision model through Zaino's own gateway, and posts what the
model read back to the portal. The portal compares that reading against the
payment row and approves when — and only when — the fields earn it.

## The one rule

**The model reads. The code decides.**

The reader is sent the image and a prompt. It is never sent the expected
amount or the authorization number, because a reader shown the answer will
agree with it. It returns five fields, or `null` for any it cannot see
clearly, and `scoreVerification()` compares them against what the database
already knows the customer owes.

A model reply of "everything matches, approve" has no path to approval
except by returning fields that genuinely match. There is no `verdict` field
in the request body; sending one does nothing.

## What each verdict means

| Verdict  | When                                                                                                                               | What happens                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pass`   | Amount within 50 millimes, authorization number exact, nothing flagged, score ≥ 85                                                 | Auto-approved if `D17_VERIFY_AUTO_APPROVE=true`; otherwise sits in the queue with a green reading attached |
| `review` | A field unreadable, the phone belongs to a flagged account, the receipt is outside the age window, or the score is below the floor | Stays in the human queue, with the reason shown                                                            |
| `fail`   | The amount does not match                                                                                                          | Stays in the queue and is marked as a mismatch                                                             |

An authorization number that does not match is a `review`, not a `fail`. The
customer never types that number — it is read off a photograph — and the
reader was measured returning `A1B2C304` for a printed `A1B2C3D4` on a clean
image about one read in three under load. A hard fail would reject a paying
customer over a slip they cannot see or fix; a reviewer compares two
eight-character strings in seconds. A forgery looks identical to a slip here,
which is exactly why a person decides.

The direction of failure is fixed: anything uncertain is a `review`, never a
`pass`. The human queue is the fallback, not the exception path, so the
agent being absent and the agent being unsure produce the same outcome — a
person looks.

## Setup

### 1. Apply the migration

```bash
./scripts/db-migrate.sh
```

Creates `payments_d17_verifications`. One row per reading, pass or fail, on
the payment it decided about. This is the evidence a chargeback reads.

### 2. Set the environment

On the **portal**:

| Variable                               | Required    | Default | What it does                                                                                                                                                          |
| -------------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D17_AGENT_TOKEN`                      | yes         | —       | The service token n8n presents. Must be ≥32 chars; shorter is treated as unset and every agent route answers 503.                                                     |
| `D17_VERIFY_AUTO_APPROVE`              | no          | `false` | The master switch. While false, a passing reading is recorded and the payment still waits for a human. **Turn this on only after reading the runbook section below.** |
| `D17_VERIFY_MIN_SCORE`                 | no          | `85`    | Below this a `pass` becomes a `review`.                                                                                                                               |
| `D17_VERIFY_AMOUNT_TOLERANCE_MILLIMES` | no          | `50`    | How far the printed amount may sit from the invoice.                                                                                                                  |
| `D17_VERIFY_MAX_PROOF_AGE_HOURS`       | no          | `48`    | A receipt printed earlier than this is stale.                                                                                                                         |
| `D17_RECEIVER_PHONE`                   | recommended | —       | The merchant number the money must have reached. Unset it and the receiver check is skipped, which is a real weakening.                                               |
| `D17_QUEUE_WARN_HOURS`                 | no          | `4`     | Proofs older than this are flagged by `agedProofs()`.                                                                                                                 |

Generate the token:

```bash
openssl rand -hex 32
```

On **n8n**: `D17_AGENT_TOKEN` (the same value) and `ZAINO_AGENT_API_KEY` (a
Zaino API key belonging to an org with a plan — the reader call is metered
like any other).

### 3. Import the workflow

`ops/n8n/d17-verify.json` → n8n → Import from File. It ships **inactive**.
Run it once manually against a single payment before turning the schedule on.

Two environment details the workflow depends on, both supplied by
`docker-compose.n8n.yml`:

- **`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.** Both tokens reach the HTTP
  nodes through `$env`, and n8n blocks that by default. Without it the
  headers render as `Bearer undefined` and the run shows three 401s, which
  reads like a wrong token rather than blocked configuration.
- **Publishing, on n8n 2.x.** Importing no longer switches a workflow on:
  `"active": false` arrives as a draft and `active` is not an activation
  switch any more. Publish it explicitly after the manual run.

### 4. What the workflow costs

One `smart` vision call per new proof, roughly 1,200 input tokens for a
phone screenshot plus ~120 out. At the 0.20 DT/1M block cost that is a
fraction of a millime per payment. The org key is metered normally, so the
cost shows up in the pool like any other usage.

## Before turning on auto-approval

Auto-approving a payment means money moves without a human reading the
screenshot. That is defensible for a product at this volume **only with the
evidence trail intact and a way back**. Before setting
`D17_VERIFY_AUTO_APPROVE=true`:

1. **Run in shadow mode for two weeks.** Leave auto-approve off. Every
   payment still gets a reading, and staff approve by hand as they do now.
   Compare: how often did the agent say `pass` on a payment a human would
   have rejected? That number is your false-positive rate, and it is the
   only thing that should decide whether to flip the switch.

2. **Confirm the receiver phone is set.** With `D17_RECEIVER_PHONE` unset,
   the check that the money reached _your_ account is skipped and a receipt
   paid to anyone passes that field. This is the weakest point in the chain.

   Check it returns something before you trust a `pass`:

   ```bash
   ssh <box> "docker exec <portal-container> printenv D17_RECEIVER_PHONE"
   ```

   A value that is not a real Tunisian number is treated as unset —
   `d17ReceiverPhone()` validates the 2/4/5/7/9 prefix and returns empty
   otherwise, logging one warning. That guard exists because
   `D17_RECEIVER_PHONE=+21600000000`, the old `.env.example` placeholder,
   normalized to a well-shaped `00000000` and sent every honest payment to
   `review` with `receiver_mismatch`; on a production deploy it meant the
   auto-approve switch could never fire.

3. **Know the reconciliation.** `payments_d17_verifications` is append-only.
   `approved IS TRUE` rows are the ones the agent let through. A weekly
   query of that index against the D17 statement is the control that catches
   a model that read a real but _reused_ receipt before the UNIQUE
   constraint on `authorization_number` does.

## Rejecting an auto-approved payment

There is no un-approve button, deliberately: an approval has already
activated a subscription and sent a receipt. Reversing it is a staff action
on the subscription (cancel or downgrade) plus a note in the audit log —
the same path as any mistaken manual approval. What makes it _findable_ is
that the auto-approval left a row naming the model, the prompt version, the
extracted fields, and the score.

## Testing

Unit matrix — the decision, every branch:

```bash
npx vitest run tests/d17-verify.test.ts
```

End to end — the same HTTP sequence the workflow makes:

```bash
python3 ops/n8n/make-fixtures.py
PORTAL=http://localhost:3000 GATEWAY=http://localhost:4000 \
AGENT_TOKEN=... LITELLM_MASTER_KEY=... \
node ops/n8n/test-e2e.mjs
```

`make-fixtures.py` renders seven synthetic receipts: a clean match, an
underpayment, a wrong authorization number, a wrong merchant, a stale date,
a blurred image, and a photo of a desk. The last two exist to prove the
reader returns `null` rather than guessing digits it cannot see — that is
the hallucination test, and it is the reason the prompt never receives the
expected values.

## Why the workflow is not the decision

Every judgement lives in `lib/billing/d17-verify.ts`, which is pure and has
no I/O. The n8n workflow extracts fields and posts them. If someone edits a
code node in n8n and it starts mislabelling a field, the outcome is a wrong
_reason_ on a row — never a wrong approval, because the server re-derives
the verdict from the fields it receives and compares them to the invoice.

The same logic applies to the token: it can read the queue and submit
readings. It cannot approve arbitrary payments, cannot read customer
identity, and cannot touch any other admin surface.
