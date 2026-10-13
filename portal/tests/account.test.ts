/**
 * Account-operation unit tests — the pure rules.
 *
 * The database paths (profile write, password write, gateway teardown) are
 * verified end-to-end by the same approach as the money path: against the
 * live stack, not against a fake. What belongs HERE is the logic that is
 * pure and would be catastrophic to get wrong quietly:
 *
 *   - `sessionIsFresh` decides whether a stolen cookie still works after a
 *     password change. A sign flip here is either "every user is logged out
 *     every minute" or "a compromised account cannot be recovered".
 *   - `csvCell` is the formula-injection guard on a file people open in
 *     Excel.
 */

import { describe, expect, it } from 'vitest';
import { sessionIsFresh } from '@/lib/auth/session-freshness';
import { csvCell } from '@/lib/csv';

describe('session freshness', () => {
  const stamp = new Date('2026-10-01T12:00:00.000Z');

  it('accepts a token minted at or after the last password change', () => {
    expect(sessionIsFresh('2026-10-01T12:00:00.000Z', stamp)).toBe(true);
    expect(sessionIsFresh('2026-10-01T12:00:01.000Z', stamp)).toBe(true);
  });

  it('rejects a token minted before the change — this is the whole point', () => {
    expect(sessionIsFresh('2026-09-30T23:59:59.000Z', stamp)).toBe(false);
  });

  it('rejects a token with no stamp: it predates the mechanism', () => {
    expect(sessionIsFresh(null, stamp)).toBe(false);
    expect(sessionIsFresh(undefined, stamp)).toBe(false);
  });

  it('rejects an unparseable stamp rather than failing open', () => {
    expect(sessionIsFresh('not-a-date', stamp)).toBe(false);
  });

  it('accepts everything when there is no row to compare against', () => {
    expect(sessionIsFresh(null, null)).toBe(true);
  });

  it('compares instants, not strings: sub-second precision must not reject', () => {
    // Postgres keeps microseconds, the JWT keeps milliseconds. Textual
    // equality would reject a token issued in the same millisecond.
    const row = new Date('2026-10-01T12:00:00.000Z');
    expect(sessionIsFresh('2026-10-01T12:00:00.000Z', row)).toBe(true);
  });

  it('invalidates a token one millisecond early', () => {
    const row = new Date('2026-10-01T12:00:00.001Z');
    expect(sessionIsFresh('2026-10-01T12:00:00.000Z', row)).toBe(false);
  });
});

describe('CSV cells', () => {
  it('quotes values containing a comma, quote or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas', () => {
    // Without the guard, opening the file evaluates these in Excel.
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves an ordinary value alone', () => {
    expect(csvCell('fast')).toBe('fast');
    expect(csvCell(42)).toBe('42');
  });

  it('renders null and undefined as an empty cell, not "null"', () => {
    // `latency_ms` is genuinely never measured; "null" in a spreadsheet is
    // a bug report waiting to happen.
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});