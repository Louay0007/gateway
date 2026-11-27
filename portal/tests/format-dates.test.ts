/**
 * Date formatters must degrade, not throw.
 *
 * `Intl.DateTimeFormat.format()` throws `RangeError: Invalid time value` on a
 * NaN date. `dateTime()` was called inside `.map()` over database rows, so ONE
 * row with no timestamp took the whole page down with a 500 — found on
 * `/admin/payments`, where `submittedAt ?? verifiedAt ?? ""` produced an empty
 * string and the ledger died instead of rendering the other rows.
 *
 * A formatter's job is to render; "no date" has an honest representation (an
 * em dash) and failing the request is never it.
 */
import { describe, it, expect } from 'vitest';

import { dateTime, relativeTime, shortDate } from '@/lib/dashboard/format';

describe('date formatters never throw', () => {
  const BAD = ['', 'null', 'undefined', 'not-a-date', '2026-13-45T99:99:99Z'];

  it.each(BAD)('dateTime(%j) degrades to an em dash', (v) => {
    expect(() => dateTime(v)).not.toThrow();
    expect(dateTime(v)).toBe('—');
  });

  it.each(BAD)('shortDate(%j) degrades to an em dash', (v) => {
    expect(() => shortDate(v)).not.toThrow();
    expect(shortDate(v)).toBe('—');
  });

  it('dateTime accepts null/undefined (the DB row with no timestamp)', () => {
    expect(dateTime(null)).toBe('—');
    expect(dateTime(undefined)).toBe('—');
  });

  it('relativeTime already degraded, and still does', () => {
    for (const v of [...BAD, null]) {
      expect(() => relativeTime(v as string | null)).not.toThrow();
    }
    expect(relativeTime(null)).toBe('Never');
  });

  it('still formats a real date', () => {
    const out = dateTime('2026-11-26T12:00:00.000Z');
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(4);
  });
});
