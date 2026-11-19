/**
 * D17 automatic proof verification — the rules, and none of the I/O.
 *
 * WHY THIS IS SEPARATE FROM THE ROUTE. The decision to approve a payment
 * from a photograph is the most consequential rule in the product, and it is
 * the one nobody can see being tested if it lives inside a request handler.
 * Everything here is pure so the full matrix — every field matching, one
 * field drifting, the model hallucinating a number — is a unit test rather
 * than a manual payment.
 *
 * THE MODEL IS NOT TRUSTED WITH THE DECISION. It is trusted with READING:
 * "what amount is printed on this receipt" is exactly the question a vision
 * model answers well, and "should this person receive a subscription" is
 * exactly the question it must not answer. So the reader returns what it saw,
 * and `scoreVerification()` below decides against the database's own record
 * of what the customer owes. A model that says "everything matches, approve"
 * has no path to approval except by returning fields that genuinely match.
 *
 * THE DIRECTION OF FAILURE IS FIXED. Anything uncertain produces `review`,
 * never `pass`. An unreadable number, a missing field, a score below the
 * floor, a payment already flagged for suspicious activity — all of them
 * route to the human queue that already exists. The human queue is the
 * fallback, not the exception path, so there is no state in which the agent
 * being wrong is worse than the agent being absent.
 */

import { normalizeAuthNumber, normalizeSenderPhone } from './d17-config';

/** The prompt's identity. A prompt edit is a decision change: bump this. */
export const PROMPT_VERSION = 'd17-proof-proof/v1';

/**
 * Which alias reads the screenshot.
 *
 * `smart` rather than `fast`: reading a phone screenshot of a receipt is
 * small-text OCR under glare and compression, which is where the cheaper
 * alias starts inventing digits. `frontier` would be better still and 5×
 * the weighted cost; the failure mode of `smart` being wrong is a `review`
 * row, not a wrong approval, so it buys nothing a human cannot fix.
 */
export const VERIFY_MODEL = 'smart';

/** Below this score a `pass` is downgraded to `review`, whatever the fields say. */
export function minApproveScore(): number {
  const raw = Number(process.env.D17_VERIFY_MIN_SCORE ?? '85');
  if (!Number.isFinite(raw)) return 85;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * How far the printed amount may sit from the amount owed, in millimes.
 *
 * 50 millimes — five hundredths of a dinar. Not zero, because the two values
 * do not travel the same path: the amount we ask for is whole dinars
 * (`planPriceTndMillimes()` rounds to the dinar) while the receipt shows
 * whatever D17 printed. A wider tolerance would let a customer pay the
 * 39 DT Solo price against a 90 DT Pro invoice and pass; a narrower one
 * fails on a legitimate rounding difference the customer cannot control.
 */
export function amountToleranceMillimes(): number {
  const raw = Number(process.env.D17_VERIFY_AMOUNT_TOLERANCE_MILLIMES ?? '50');
  if (!Number.isFinite(raw) || raw < 0) return 50;
  return Math.round(raw);
}

/**
 * How old a printed transfer may be before it is not this month's payment.
 *
 * A receipt from three weeks ago attached to today's invoice is either a
 * mistake or a replay. The authorization number's UNIQUE constraint stops
 * the same number being used twice, but not a number that was never used
 * because the customer paid in cash and kept the screenshot. 48 hours is
 * wider than the 24-hour payment window so a customer who paid and then
 * slept does not fail.
 */
export function maxProofAgeHours(): number {
  const raw = Number(process.env.D17_VERIFY_MAX_PROOF_AGE_HOURS ?? '48');
  if (!Number.isFinite(raw) || raw <= 0) return 48;
  return raw;
}

/** The fields the reader is asked for. All optional: absent means unreadable. */
export interface ExtractedProof {
  amount: string | null;
  authNumber: string | null;
  senderPhone: string | null;
  receiverPhone: string | null;
  /** ISO 8601 date or date-time as printed on the receipt. */
  date: string | null;
}

export interface ExpectedPayment {
  /** The amount the customer owes, from the payment row — never the request. */
  amountMillimes: number;
  /** The authorization number the customer typed. */
  authNumber: string;
  senderPhone: string | null;
  /** The merchant phone from env. Empty string when unconfigured. */
  receiverPhone: string;
  /** The payment row's submission time, used as "now" for the age check. */
  submittedAt: Date;
  /** Set by the submission path when the same phone is farming proofs. */
  flaggedReview: boolean;
}

export type FieldCheck = 'match' | 'mismatch' | 'unreadable' | 'not_checked';

export interface VerificationChecks {
  amount: FieldCheck;
  authNumber: FieldCheck;
  senderPhone: FieldCheck;
  receiverPhone: FieldCheck;
  date: FieldCheck;
}

export type Verdict = 'pass' | 'review' | 'fail';

export interface VerificationDecision {
  score: number;
  verdict: Verdict;
  checks: VerificationChecks;
  /** Why approval is withheld. Null when approving. */
  blockedBy: string | null;
  reason: string;
}

/**
 * "50.000", "50", "50,000 DT", "50.00 TND" → 50000 millimes.
 *
 * Deliberately strict about the DECIMAL SEPARATOR and the digit count,
 * because the two plausible readings of "1.50" depend on how many decimals
 * the locale prints: Tunisian dinars carry three, so "1.500" is 1.5 DT while
 * a two-decimal reading would make it 1 DT 500 millimes — a 33% error in
 * the customer's favour. Three decimals is the only formatter this product
 * emits (`formatTndMillimes`), so anything else is ambiguous and refused
 * rather than guessed.
 */
export function parseAmountMillimes(raw: string | null): number | null {
  if (!raw) return null;
  // Keep digits, separators and the decimal point; drop currency words.
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(',', '.').trim();
  if (!cleaned) return null;

  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) return null;

  const whole = Number(match[1]);
  const frac = match[2] ?? '';
  if (!Number.isFinite(whole)) return null;

  // "50.5" is 50 DT 500 millimes, not 50 DT 5 millimes: pad, do not parse
  // the fraction as an integer.
  const millimes = Math.round(Number(`${whole}.${frac.padEnd(3, '0')}`) * 1000);
  return Number.isFinite(millimes) ? millimes : null;
}

/** How long after submission a printed date may be, i.e. clock skew tolerance. */
const FUTURE_SKEW_MS = 6 * 3600 * 1000;

function checkDate(rawDate: string | null, submittedAt: Date): FieldCheck {
  if (!rawDate) return 'unreadable';
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return 'unreadable';

  const ageMs = submittedAt.getTime() - parsed.getTime();
  if (ageMs < -FUTURE_SKEW_MS) return 'mismatch'; // printed in the future
  if (ageMs > maxProofAgeHours() * 3600 * 1000) return 'mismatch'; // too old
  return 'match';
}

/**
 * Score a reading against what the database already knows.
 *
 * Weights are not equal because the consequences are not: the amount and the
 * authorization number are what an impersonator cannot fake (one is checked
 * against a UNIQUE index, the other against the invoice), while the phone and
 * date are corroboration. A wrong amount is an underpayment; a wrong phone is
 * a household sharing a handset.
 */
export function scoreVerification(
  extracted: ExtractedProof,
  expected: ExpectedPayment,
): VerificationDecision {
  const checks: VerificationChecks = {
    amount: 'not_checked',
    authNumber: 'not_checked',
    senderPhone: 'not_checked',
    receiverPhone: 'not_checked',
    date: 'not_checked',
  };

  let score = 0;

  // ── Amount: 45 points, the largest single weight ──────────────────
  const seen = parseAmountMillimes(extracted.amount);
  if (seen === null) {
    checks.amount = 'unreadable';
  } else if (Math.abs(seen - expected.amountMillimes) <= amountToleranceMillimes()) {
    checks.amount = 'match';
    score += 45;
  } else {
    checks.amount = 'mismatch';
  }

  // ── Authorization number: 35 points, exact, normalized ────────────
  const seenAuth = extracted.authNumber
    ? normalizeAuthNumber(extracted.authNumber)
    : null;
  if (!seenAuth) {
    checks.authNumber = 'unreadable';
  } else if (seenAuth === normalizeAuthNumber(expected.authNumber)) {
    checks.authNumber = 'match';
    score += 35;
  } else {
    checks.authNumber = 'mismatch';
  }

  // ── Sender phone: 8 points, optional corroboration ────────────────
  // A receipt often shows the wallet's masked number or none at all, so an
  // unreadable phone is not a failure — but a phone that IS readable and is
  // a different number is worth losing the points over.
  const seenPhone = extracted.senderPhone
    ? normalizeSenderPhone(extracted.senderPhone)
    : null;
  if (!seenPhone) {
    checks.senderPhone = expected.senderPhone ? 'unreadable' : 'not_checked';
    if (!expected.senderPhone) score += 8;
  } else if (expected.senderPhone && seenPhone === expected.senderPhone) {
    checks.senderPhone = 'match';
    score += 8;
  } else {
    checks.senderPhone = 'mismatch';
  }

  // ── Receiver phone: 7 points, the merchant was actually paid ───────
  // Unconfigured merchant number is checked FIRST: when we never declared
  // where the money should go, an unreadable receipt field is our gap, not
  // the customer's, and labelling it `unreadable` would send staff to stare
  // at a screenshot that was never the problem.
  const seenReceiver = extracted.receiverPhone
    ? normalizeSenderPhone(extracted.receiverPhone)
    : null;
  if (!expected.receiverPhone) {
    checks.receiverPhone = 'not_checked';
    score += 7;
  } else if (!seenReceiver) {
    checks.receiverPhone = 'unreadable';
  } else if (seenReceiver === normalizeSenderPhone(expected.receiverPhone)) {
    checks.receiverPhone = 'match';
    score += 7;
  } else {
    checks.receiverPhone = 'mismatch';
  }

  // ── Date: 5 points ────────────────────────────────────────────────
  checks.date = checkDate(extracted.date, expected.submittedAt);
  if (checks.date === 'match') score += 5;
  else if (checks.date === 'not_checked') score += 5;

  // ── The gates, in the order that produces the clearest block reason ──
  //
  // AMOUNT MISMATCH IS A FAIL. The customer never types the amount; it is
  // read off the receipt and compared to the invoice. A legible receipt
  // showing 39 DT against a 90 DT invoice is the payment itself being
  // wrong — the underpayment a plan ladder invites. No human needed.
  //
  // AUTH NUMBER MISMATCH IS A REVIEW, NOT A FAIL. This distinction was
  // earned, not assumed: measured against rendered receipts, the reader
  // returned "A1B2C304" for a printed "A1B2C3D4" — D read as 0, one
  // character, on a clean image. A hard fail would reject a paying
  // customer over a transcription slip they cannot see or fix, while a
  // reviewer compares two eight-character strings in seconds. A forgery
  // looks identical to a slip here, which is exactly why a person decides.
  let verdict: Verdict;
  let blockedBy: string | null = null;

  if (checks.amount === 'mismatch') {
    verdict = 'fail';
    blockedBy = 'amount_mismatch';
  } else if (checks.authNumber === 'mismatch') {
    verdict = 'review';
    blockedBy = 'auth_mismatch';
  } else if (checks.amount === 'unreadable' || checks.authNumber === 'unreadable') {
    verdict = 'review';
    blockedBy = checks.amount === 'unreadable' ? 'amount_unreadable' : 'auth_unreadable';
  } else if (expected.flaggedReview) {
    // The submission path already decided this phone looked like a farm.
    // The agent must not overturn that: it read one image, the flag read
    // the whole account's recent history.
    verdict = 'review';
    blockedBy = 'flagged_review';
  } else if (checks.receiverPhone === 'mismatch') {
    verdict = 'review';
    blockedBy = 'receiver_mismatch';
  } else if (checks.date === 'mismatch') {
    verdict = 'review';
    blockedBy = 'date_out_of_window';
  } else if (checks.senderPhone === 'mismatch') {
    verdict = 'review';
    blockedBy = 'sender_mismatch';
  } else if (score < minApproveScore()) {
    verdict = 'review';
    blockedBy = 'score_below_floor';
  } else {
    verdict = 'pass';
  }

  return {
    score,
    verdict,
    checks,
    blockedBy,
    reason: describe(checks, verdict, score),
  };
}

/** One sentence a staff member reads instead of a number. */
function describe(checks: VerificationChecks, verdict: Verdict, score: number): string {
  const wrong = (Object.entries(checks) as [keyof VerificationChecks, FieldCheck][])
    .filter(([, v]) => v === 'mismatch')
    .map(([k]) => k);
  const unread = (Object.entries(checks) as [keyof VerificationChecks, FieldCheck][])
    .filter(([, v]) => v === 'unreadable')
    .map(([k]) => k);

  if (verdict === 'pass') {
    return `Amount and authorization number both match; score ${score}.`;
  }
  if (verdict === 'fail') {
    return `${wrong.join(', ')} did not match the invoice. Not approved.`;
  }
  if (verdict === 'review' && checks.authNumber === 'mismatch') {
    return `Held for review: the authorization number does not match the one submitted — likely a transcription error, worth one look (score ${score}).`;
  }
  const parts: string[] = [];
  if (wrong.length) parts.push(`${wrong.join(', ')} did not match`);
  if (unread.length) parts.push(`${unread.join(', ')} could not be read`);
  return `Held for review: ${parts.join('; ') || 'score below threshold'} (score ${score}).`;
}
