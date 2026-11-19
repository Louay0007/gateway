/**
 * D17 automatic proof verification — the decision, exhaustively.
 *
 * Why this file is longer than the module it tests. `scoreVerification()` is
 * the only thing standing between a photograph and a paid subscription, and
 * every branch of it is a way the product can be robbed. The cases below are
 * grouped by the failure they prevent, not by the function's structure:
 *
 *   1. The forged/underpaid proof   → amount or auth mismatch is a hard fail
 *   2. The unreadable proof         → never a pass, always a human
 *   3. The stale or replayed proof  → date window
 *   4. The flagged account          → the agent cannot overturn the farm flag
 *   5. The honest customer          → must actually pass, or the feature is
 *                                     just a slower manual queue
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ExpectedPayment,
  type ExtractedProof,
  parseAmountMillimes,
  scoreVerification,
} from '@/lib/billing/d17-verify';

/** A Pro invoice: 90 DT, submitted an hour ago, nothing suspicious. */
const NOW = new Date('2026-11-19T12:00:00Z');
const expected: ExpectedPayment = {
  amountMillimes: 90_000,
  authNumber: 'A1B2C3D4',
  senderPhone: '20123456',
  receiverPhone: '71999999',
  submittedAt: NOW,
  flaggedReview: false,
};

function reading(over: Partial<ExtractedProof> = {}): ExtractedProof {
  return {
    amount: '90.000',
    authNumber: 'A1B2C3D4',
    senderPhone: '20123456',
    receiverPhone: '71999999',
    date: '2026-11-19T11:30:00Z',
    ...over,
  };
}

beforeEach(() => {
  delete process.env.D17_VERIFY_MIN_SCORE;
  delete process.env.D17_VERIFY_AMOUNT_TOLERANCE_MILLIMES;
  delete process.env.D17_VERIFY_MAX_PROOF_AGE_HOURS;
});

afterEach(() => {
  delete process.env.D17_VERIFY_MIN_SCORE;
  delete process.env.D17_VERIFY_AMOUNT_TOLERANCE_MILLIMES;
  delete process.env.D17_VERIFY_MAX_PROOF_AGE_HOURS;
});

describe('parseAmountMillimes', () => {
  it('reads the three-decimal form this product emits', () => {
    expect(parseAmountMillimes('90.000')).toBe(90_000);
    expect(parseAmountMillimes('1.500')).toBe(1_500);
    expect(parseAmountMillimes('0.005')).toBe(5);
  });

  it('treats a comma as the decimal separator, as D17 receipts print it', () => {
    expect(parseAmountMillimes('90,000')).toBe(90_000);
  });

  it('accepts a bare integer as whole dinars', () => {
    expect(parseAmountMillimes('90')).toBe(90_000);
    expect(parseAmountMillimes('90 DT')).toBe(90_000);
  });

  it('pads a short fraction rightward, never leftward', () => {
    // "90.5" is 90 DT 500 millimes. Reading it as 90 DT 005 millimes would
    // undercharge by a factor of 100 — the direction a forger wants.
    expect(parseAmountMillimes('90.5')).toBe(90_500);
    expect(parseAmountMillimes('90.05')).toBe(90_050);
  });

  it('refuses a fourth decimal rather than rounding it', () => {
    // Four decimals is not a formatter this product or D17 emits; it means
    // the model read something wrong. Guess-free refusal.
    expect(parseAmountMillimes('90.0005')).toBeNull();
  });

  it('strips currency words and whitespace', () => {
    expect(parseAmountMillimes(' 90.000 TND ')).toBe(90_000);
    expect(parseAmountMillimes('Montant: 90,000 DT')).toBe(90_000);
  });

  it('returns null for nothing to parse', () => {
    expect(parseAmountMillimes(null)).toBeNull();
    expect(parseAmountMillimes('')).toBeNull();
    expect(parseAmountMillimes('DT')).toBeNull();
  });
});

describe('scoreVerification — the honest customer passes', () => {
  it('approves a full match with a score of 100', () => {
    const d = scoreVerification(reading(), expected);
    expect(d.verdict).toBe('pass');
    expect(d.score).toBe(100);
    expect(d.blockedBy).toBeNull();
    expect(d.checks).toEqual({
      amount: 'match',
      authNumber: 'match',
      senderPhone: 'match',
      receiverPhone: 'match',
      date: 'match',
    });
  });

  it('normalizes case and whitespace in the authorization number', () => {
    const d = scoreVerification(reading({ authNumber: ' a1b2c3d4 ' }), expected);
    expect(d.checks.authNumber).toBe('match');
    expect(d.verdict).toBe('pass');
  });

  it('tolerates the +216 prefix on the sender phone', () => {
    const d = scoreVerification(reading({ senderPhone: '+216 20 123 456' }), expected);
    expect(d.checks.senderPhone).toBe('match');
  });

  it('absorbs a rounding difference within the tolerance', () => {
    // 90.040 DT vs 90.000 owed: 40 millimes, inside the 50 default.
    const d = scoreVerification(reading({ amount: '90.040' }), expected);
    expect(d.checks.amount).toBe('match');
    expect(d.verdict).toBe('pass');
  });
});

describe('scoreVerification — forged or wrong proofs fail', () => {
  it('fails an underpayment even when everything else matches', () => {
    // The attack: pay the 39 DT Solo price against a 90 DT invoice.
    const d = scoreVerification(reading({ amount: '39.000' }), expected);
    expect(d.verdict).toBe('fail');
    expect(d.blockedBy).toBe('amount_mismatch');
    expect(d.checks.amount).toBe('mismatch');
  });

  it('holds a wrong authorization number for review, not fail', () => {
    // Measured: the reader returns "A1B2C304" for a printed "A1B2C3D4" on
    // a clean image. A forgery and a transcription slip look identical
    // here, and only a person can tell them apart.
    const d = scoreVerification(reading({ authNumber: 'ZZZZ9999' }), expected);
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('auth_mismatch');
    expect(d.reason).toMatch(/transcription error/);
  });

  it('never approves on an authorization mismatch, whatever the score', () => {
    const d = scoreVerification(reading({ authNumber: 'A1B2C304' }), expected);
    expect(d.verdict).not.toBe('pass');
    expect(d.score).toBe(65);
  });

  it('names the authorization number in the fail reason when amount is right', () => {
    // Amount matches, auth does not → review, not fail; the reason must
    // say which field sent it there.
    const d = scoreVerification(reading({ authNumber: 'BADBAD00' }), expected);
    expect(d.verdict).toBe('review');
    expect(d.reason).toMatch(/authorization number/);
  });

  it('does not let a perfect score average away an amount mismatch', () => {
    // All other fields match, so the total is 55 — above nothing that
    // matters, but the verdict is decided by the field, not the sum.
    const d = scoreVerification(reading({ amount: '900.000' }), expected);
    expect(d.verdict).toBe('fail');
    expect(d.score).toBe(55);
  });

  it('fails an amount outside the tolerance even by one dinar', () => {
    const d = scoreVerification(reading({ amount: '91.000' }), expected);
    expect(d.checks.amount).toBe('mismatch');
    expect(d.verdict).toBe('fail');
  });
});

describe('scoreVerification — unreadable is never a pass', () => {
  it('holds an unreadable amount for review', () => {
    const d = scoreVerification(reading({ amount: null }), expected);
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('amount_unreadable');
    expect(d.score).toBe(55);
  });

  it('holds an unreadable authorization number for review', () => {
    const d = scoreVerification(reading({ authNumber: null }), expected);
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('auth_unreadable');
  });

  it('holds a glare-blurred amount string for review, not fail', () => {
    // "9O.OOO" with a letter O — the model transcribed something, and it
    // is not a number. Unreadable, not a mismatch: a human looks.
    const d = scoreVerification(reading({ amount: '9O.OOO' }), expected);
    expect(d.checks.amount).toBe('unreadable');
    expect(d.verdict).toBe('review');
  });

  it('reports both unreadable fields in one reason', () => {
    const d = scoreVerification(reading({ amount: null, authNumber: null }), expected);
    expect(d.reason).toContain('amount');
    expect(d.reason).toContain('authNumber');
  });
});

describe('scoreVerification — stale and future proofs', () => {
  it('holds a receipt older than the age window', () => {
    const old = new Date(NOW.getTime() - 72 * 3600 * 1000).toISOString();
    const d = scoreVerification(reading({ date: old }), expected);
    expect(d.checks.date).toBe('mismatch');
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('date_out_of_window');
  });

  it('holds a receipt printed well in the future', () => {
    const future = new Date(NOW.getTime() + 48 * 3600 * 1000).toISOString();
    const d = scoreVerification(reading({ date: future }), expected);
    expect(d.checks.date).toBe('mismatch');
    expect(d.verdict).toBe('review');
  });

  it('tolerates small clock skew between phone and server', () => {
    const skewed = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
    const d = scoreVerification(reading({ date: skewed }), expected);
    expect(d.checks.date).toBe('match');
  });

  it('holds an unparseable date rather than assuming it is fine', () => {
    const d = scoreVerification(reading({ date: 'hier' }), expected);
    expect(d.checks.date).toBe('unreadable');
    // Date is only 5 points and does not gate; the other fields carry it.
    expect(d.verdict).toBe('pass');
    expect(d.score).toBe(95);
  });
});

describe('scoreVerification — flags and corroboration', () => {
  it('cannot overturn the submission path farm flag', () => {
    const flagged = { ...expected, flaggedReview: true };
    const d = scoreVerification(reading(), flagged);
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('flagged_review');
    expect(d.score).toBe(100); // the read was perfect; the account was not
  });

  it('holds a proof paid to a different merchant number', () => {
    const d = scoreVerification(reading({ receiverPhone: '71000000' }), expected);
    expect(d.checks.receiverPhone).toBe('mismatch');
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('receiver_mismatch');
  });

  it('holds a readable sender phone that is not the paying account', () => {
    const d = scoreVerification(reading({ senderPhone: '99999999' }), expected);
    expect(d.checks.senderPhone).toBe('mismatch');
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('sender_mismatch');
  });

  it('does not fail a receipt with no visible phone', () => {
    const d = scoreVerification(reading({ senderPhone: null }), expected);
    expect(d.checks.senderPhone).toBe('unreadable');
    expect(d.verdict).toBe('pass');
    expect(d.score).toBe(92);
  });

  it('skips the receiver check when no merchant number is configured', () => {
    const unconfigured = { ...expected, receiverPhone: '' };
    const d = scoreVerification(reading({ receiverPhone: null }), unconfigured);
    expect(d.checks.receiverPhone).toBe('not_checked');
    expect(d.verdict).toBe('pass');
  });
});

describe('scoreVerification — the score floor', () => {
  it('downgrades a pass below the configured floor', () => {
    process.env.D17_VERIFY_MIN_SCORE = '95';
    // Date and sender phone both unreadable → 100 - 8 - 5 = 87, under 95.
    const d = scoreVerification(reading({ senderPhone: null, date: null }), expected);
    expect(d.verdict).toBe('review');
    expect(d.blockedBy).toBe('score_below_floor');
    expect(d.score).toBe(87);
  });

  it('clamps the configured floor into 0..100', () => {
    process.env.D17_VERIFY_MIN_SCORE = '500';
    const d = scoreVerification(reading(), expected);
    // Clamped to 100, and a perfect read still reaches it.
    expect(d.score).toBe(100);
    expect(d.verdict).toBe('pass');
  });

  it('honours a lowered tolerance for the amount', () => {
    process.env.D17_VERIFY_AMOUNT_TOLERANCE_MILLIMES = '0';
    const d = scoreVerification(reading({ amount: '90.040' }), expected);
    expect(d.checks.amount).toBe('mismatch');
    expect(d.verdict).toBe('fail');
  });
});

describe('scoreVerification — the reason string', () => {
  it('names what did not match on a fail', () => {
    const d = scoreVerification(reading({ amount: '39.000', authNumber: 'BAD' }), expected);
    expect(d.reason).toMatch(/amount/);
    expect(d.reason).toMatch(/authNumber/);
    expect(d.reason).toMatch(/Not approved/i);
  });

  it('names what could not be read on a review', () => {
    const d = scoreVerification(reading({ authNumber: null }), expected);
    expect(d.reason).toMatch(/authNumber could not be read/);
    expect(d.reason).toMatch(/score 65/);
  });

  it('says so plainly on a pass', () => {
    const d = scoreVerification(reading(), expected);
    expect(d.reason).toMatch(/both match/);
  });
});
