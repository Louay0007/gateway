import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The usage page must display the server's weighted number, never its own
 * arithmetic. Both used to add the five raw columns in the browser, which
 * reproduced the pre-8ea5247 formula and made a row disagree with the total
 * printed directly above it.
 */
describe('usage display', () => {
  const view = readFileSync('components/dashboard/usage-view.tsx', 'utf8');

  it('renders the server-computed blendedTokens per row', () => {
    expect(view).toContain('compact(row.blendedTokens)');
  });

  it('does not re-add the raw token columns in the browser', () => {
    // The old formula was a five-term sum. Showing the raw cache count in its
    // own column is fine; summing the columns to produce a TOTAL is not.
    expect(view).not.toMatch(/row\.inputTokens\s*\+/);
    expect(view).not.toMatch(/cacheWrite1hTokens\s*\+/);
    expect(view).not.toMatch(/\+\s*row\.cacheReadTokens/);
  });

  it('the model breakdown sums the same field the table shows', () => {
    expect(view).toMatch(/entry\.tokens \+= row\.blendedTokens/);
  });
});

describe('usage API', () => {
  const svc = readFileSync('lib/billing/service.ts', 'utf8');

  it('computes the row figure with the canonical expression', () => {
    expect(svc).toMatch(
      /\(\$\{sql\.raw\(BILLABLE_TOKEN_COLUMNS\)\}\)::bigint AS blended_tokens/,
    );
  });

  it('exposes it on the row type', () => {
    expect(svc).toMatch(/blendedTokens: number;/);
    expect(svc).toContain('blendedTokens: Number(r.blended_tokens ?? 0)');
  });
});
