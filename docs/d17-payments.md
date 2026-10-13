# D17 payments (La Poste Tunisienne) — manual verification

D17 has **no public merchant API and no webhooks**. The customer transfers
money inside the D17 app, D17 shows them an **authorization number**, and a
human confirms the transfer in the app's transaction history. This
document is the runbook for that flow.

> **We never ask for, accept, or store a PIN, card number, or CIN.** The
> customer-facing page says so, and no form field exists that could carry
> one.

## How it works

```
POST /api/checkout {planCode, method:'d17'}
        │  creates the subscription row (incomplete) AND the payments_d17
        │  row (pending_payment, expires_at = now + PAYMENT_WINDOW_HOURS)
        ▼
/checkout/d17/[subscriptionId]      instructions + proof form
        │  authorization number, sender phone, optional screenshot
        ▼  status: pending_payment → proof_submitted
POST /api/billing/callback?  ← nothing. D17 sends no webhook.
        │  A HUMAN verifies instead:
        ▼
/admin/d17                          staff-only queue + checklist
        ├─ Approve → applyCallback('d17:<id>:approved') → subscription
        │            active + entitlement sync + customer email
        └─ Reject  → reason required → customer email → one resubmit
```

Approval is **idempotent**: the event id `d17:<paymentId>:approved` is
deduped by `billing_events`, so a double click, a retried request, or two
admins racing activate the subscription exactly once.

## Configuration (environment)

| Variable | Default | Notes |
|---|---|---|
| `D17_RECEIVER_PHONE` | — | **Required.** The merchant number that receives transfers. Must be registered in D17. |
| `PAYMENT_WINDOW_HOURS` | `24` | Hours the customer has to transfer + submit. Past this, the payment expires and the admin queue stays clean. |
| `AUTH_NUMBER_REGEX` | `^[A-Za-z0-9]{4,32}$` | D17 does not document the format. Tighten this once you have real examples; an absolute 64-char ceiling is always enforced. |
| `D17_USD_TND_RATE` | `3.1` | USD→TND rate used to price plans in millimes. **Verify before charging** — plan prices in the catalog are USD. |
| `D17_REVIEW_THRESHOLD` | `3` | Submissions from one phone, inside the window, above which a payment is flagged **needs review** in the admin queue. |
| `D17_REVIEW_WINDOW_MINUTES` | `60` | The window for the flag above. |
| `D17_MAX_PROOF_PER_HOUR` | `5` | Proof submissions per hour, per IP **and** per subscription. |
| `D17_UPLOADS_DIR` | `/app/data/d17-uploads` | Screenshot storage. Outside the web root by construction; only the staff route reads it. |
| `OPS_ALERT_EMAIL` | — | Where the "new proof to verify" email goes. D17 does not notify the merchant, so this is the only arrival signal. |
| `EMAIL_TRANSPORT` / `RESEND_API_KEY` / `MAIL_FROM` | `dev` / — / `Gateway <noreply@localhost>` | Shared with password reset. `dev` logs links and emails instead of sending. |

Compose passes all of these from `.env` to both `portal` and `jobs`.

## Staff access

Staff authenticate through the normal sign-in, and a `staff_users` row
(e-mail match) grants the admin panel. Staff are never org members
(separate tables, no impersonation).

Create one (once per environment):

```sql
-- after the person has signed up (or via createLocalUser), add:
INSERT INTO staff_users (email, name, role)
VALUES ('you@example.com', 'Your Name', 'owner');   -- owner | admin | support | read_only
```

`/admin/d17` requires `support` or above for approve/reject, `read_only`
to view evidence.

## Notifications

| Event | Who | Channel |
|---|---|---|
| Proof submitted | Customer (owner e-mail) | Email |
| Proof submitted | Ops | `OPS_ALERT_EMAIL` |
| Approved | Customer | Email |
| Rejected | Customer | Email (with reason) |

SMS and Telegram/WhatsApp are **not implemented** — no provider is
configured. The email transport (`lib/email/`) is the seam where they
would go, one implementation file each.

## Verification

```bash
make verify-d17     # the whole manual-payment path, in the jobs container
make verify-metering # the subscription money path it plugs into
npm run typecheck && npm test   # in portal/ (98 tests)
```

`make verify-d17` covers: amount correctness, submission, duplicate
authorization numbers, amount-tamper resistance, double approval, staff
gate (anonymous 401, signed-in customer 403), window expiry, reject +
resubmit, screenshot handling, and CSV/reconciliation output.

## Manual QA checklist

Run this once before you take a real payment.

**Before**
- [ ] `D17_RECEIVER_PHONE` is the real merchant number, registered in D17.
- [ ] `D17_USD_TND_RATE` matches the rate you intend to charge at.
- [ ] `AUTH_NUMBER_REGEX` still matches real D17 authorization numbers
      (submit one by hand and check).
- [ ] `OPS_ALERT_EMAIL` is an address you read on your phone.
- [ ] `EMAIL_TRANSPORT=resend` with a real `RESEND_API_KEY` on the VPS.
- [ ] A staff `staff_users` row exists for you, and you can open `/admin/d17`.

**Customer flow**
- [ ] `POST /api/checkout {"planCode":"starter","method":"d17"}` returns a
      checkoutUrl pointing at `/checkout/d17/<id>`.
- [ ] The instruction page shows the exact amount in 3 decimals
      (`58.900 DT`) and the deadline.
- [ ] Copy buttons copy the amount and the recipient number.
- [ ] `?lang=ar` switches to Arabic **and** right-to-left layout.
- [ ] Submitting without the confirm checkbox is refused.
- [ ] Submitting a bad phone (`123`) is refused with the phone message.
- [ ] Submitting the same authorization number twice is refused with the
      friendly duplicate message (and the attempt appears in the audit log).
- [ ] Submitting a 4 MB screenshot is refused.
- [ ] After submitting, the page shows the waiting state and the customer
      e-mail arrives.

**Admin flow**
- [ ] `/admin/d17` lists the new proof with amount, phone, auth number,
      screenshot link, and the checklist.
- [ ] Approve → the subscription is active, the customer e-mail arrives,
      and the admin panel shows it as paid.
- [ ] Approve twice → the second click says "already approved"; the
      subscription is still activated exactly once.
- [ ] Reject without a reason → refused.
- [ ] Reject with a reason → customer e-mail; the customer may resubmit.
- [ ] CSV export downloads and the totals match `/admin/d17`'s
      reconciliation figure.
- [ ] Compare the reconciliation total with the D17 app's transaction
      history for the same window.

**Safety**
- [ ] Anonymous `GET /api/admin/d17/export` → 401.
- [ ] Signed-in customer `GET /api/admin/d17/export` → 403.
- [ ] A screenshot URL opened without the staff session → 401/403, never
      the image.
- [ ] `payments_d17.authorization_number` stays UNIQUE across rows.
- [ ] After the window, a late proof is refused and the row expires.

## Files

| Path | Role |
|---|---|
| `lib/billing/d17.ts` | Provider: creates the payment row, returns the instruction URL. `verify()` throws — there is no webhook. |
| `lib/billing/d17-proof.ts` | Submission: validation, duplicate guard, rate limit, screenshot, flagging, notifications. |
| `lib/billing/d17-admin.ts` | Queue, approve (idempotent), reject, reconciliation, CSV. |
| `lib/billing/d17-config.ts` | Pure rules: amount, auth-number shape, phone, window. Unit-tested. |
| `lib/billing/d17-ratelimit.ts` | "N per hour" limiter (the login throttle's policy does not fit). |
| `lib/i18n/d17.ts` | FR / AR / EN strings + RTL direction. |
| `app/checkout/d17/[subscriptionId]/` | Instruction page, proof form, copy buttons, language switch. |
| `app/admin/d17/` | Verification queue, approve/reject actions. |
| `app/api/admin/d17/**` | Screenshot stream (staff) + CSV export (staff). |
| `scripts/verify-d17.ts` | The end-to-end proof (`make verify-d17`). |
| `db/migrations/0005_d17_payments.sql` | `payments_d17` + status enum + constraints. |

## Known limits

- **No proration**: a plan change is immediate locally; the provider-side
  price swap lands on renewal (recorded where the real PSP would be).
- **Authentication number format** is configurable but unverified until
  real examples exist.
- **JWT sessions** outlive a password change for up to 7 days.
- **One screenshot per payment**: a resubmission replaces the previous one.
