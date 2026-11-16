import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The daily cap (0043) is enforced in SQL, so these read the source. They
 * pin the two properties that matter: the cap can CUT, and it is OFF when a
 * plan does not set one.
 */
describe('daily token cap', () => {
  const src = readFileSync('lib/entitlements/allowed-models.ts', 'utf8');
  const mig = readFileSync('db/migrations/0043_daily_token_cap.sql', 'utf8');

  it('cuts every alias when the day is spent', () => {
    expect(src).toContain('allowed: dailyExhausted ? [] : allowed');
  });

  it('is a no-op for a plan with no cap', () => {
    // The guard must be `> 0`, so NULL and 0 both mean unlimited.
    expect(src).toMatch(/if \(dailyCap > 0\)/);
    expect(src).toContain('Number(row.daily_token_cap ?? 0)');
  });

  it('measures the day in the same unit as the pool', () => {
    // Same expression as the monthly wall; two different units would make
    // "3M/day" mean something other than 3M of the 50M pool.
    expect(src).toContain('BILLABLE_TOKEN_COLUMNS');
    expect(src).toContain('tunisDayWindow()');
  });

  it('ships a cap far below the monthly pool', () => {
    // starter 3M/day vs 50M pool; pro 8M/day vs 150M. A cap near the pool
    // would be a renamed monthly limit, not a daily one.
    expect(mig).toMatch(/starter' AND daily_token_cap IS NULL/);
    expect(mig).toContain('3000000');
    expect(mig).toContain('8000000');
  });

  it('never overwrites a tuned value on re-run', () => {
    expect(mig).toMatch(/daily_token_cap IS NULL/g);
  });
});
