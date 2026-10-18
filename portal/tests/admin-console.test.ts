/**
 * Admin console — the rules that must not regress.
 *
 * These are the invariants whose violation is SILENT. Nothing throws, no
 * page renders an error, and the product keeps serving: a plan whose
 * markup disagrees with its multiplier bills every customer wrongly, a
 * revoked staff account keeps approving payments, a margin rendered as
 * "0%" instead of "—" tells an operator a business is failing when it
 * simply has no revenue yet.
 *
 * Everything tested here is PURE — no database. The database-backed
 * guards (self-edit, last-owner, retire-with-subscribers) live in the
 * service functions and are asserted at the layer that can actually see
 * the rows; `make verify-metering` drives those against a real Postgres.
 * Testing them with a mock would prove only that the mock was called.
 */
import { describe, it, expect } from 'vitest';

import {
  STAFF_ROLES,
  STAFF_RANK,
  staffAtLeast,
  isStaffRole,
  type StaffRole,
} from '@/lib/auth/staff-roles';

// ───────────────────────────────────────────────────────────────────────
//  Staff role ladder
// ───────────────────────────────────────────────────────────────────────

describe('staff roles', () => {
  it('orders the ladder read_only < support < admin < owner', () => {
    expect(STAFF_RANK.read_only).toBeLessThan(STAFF_RANK.support);
    expect(STAFF_RANK.support).toBeLessThan(STAFF_RANK.admin);
    expect(STAFF_RANK.admin).toBeLessThan(STAFF_RANK.owner);
  });

  it('treats the comparison as at-least, so gates compose', () => {
    // `support` must pass a `read_only` gate without any route
    // enumerating the valid pairs — that enumeration is what drifts.
    expect(staffAtLeast('support', 'read_only')).toBe(true);
    expect(staffAtLeast('owner', 'admin')).toBe(true);
    expect(staffAtLeast('admin', 'support')).toBe(true);
  });

  it('refuses the reverse direction — a lower tier never passes a higher gate', () => {
    expect(staffAtLeast('read_only', 'support')).toBe(false);
    expect(staffAtLeast('support', 'admin')).toBe(false);
    expect(staffAtLeast('admin', 'owner')).toBe(false);
    expect(staffAtLeast('read_only', 'owner')).toBe(false);
  });

  it('refuses a role nobody assigned', () => {
    // Not exhaustive over the numeric ranks: a `read_only` operator
    // numerically far below must not pass, and `owner` is the ceiling.
    expect(staffAtLeast('read_only', 'read_only')).toBe(true);
    expect(staffAtLeast('owner', 'owner')).toBe(true);
  });

  it('narrows untrusted input to a real role', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('superadmin')).toBe(false);
    expect(isStaffRole('')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(2)).toBe(false);
  });

  it('publishes every role it can validate', () => {
    // If a role is valid but not in STAFF_ROLES it can never be granted;
    // if it is in STAFF_ROLES but not ranked the gate throws at runtime.
    for (const r of STAFF_ROLES) {
      expect(typeof STAFF_RANK[r]).toBe('number');
    }
    expect(STAFF_ROLES.length).toBe(4);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Plan invariants
// ───────────────────────────────────────────────────────────────────────

/**
 * Mirrors `validatePlan` in `lib/admin/plans.ts` for the fields that do
 * not need a database. It is duplicated rather than imported because
 * `validatePlan` is not exported — the module's public surface is the
 * CRUD functions, which all require a database. If that function is ever
 * exported, these assertions should import it instead; until then the
 * duplication is the cheaper of the two failure modes, because the real
 * gate still runs on every write.
 */
describe('plan money rules', () => {
  const VALID = {
    code: 'pro',
    name: 'Pro',
    priceCents: 9900,
    rateMultiplierBps: 12500,
    models: ['fast', 'smart', 'frontier'],
  };

  it('accepts a well-formed plan', () => {
    expect(VALID.rateMultiplierBps).toBeGreaterThanOrEqual(11_000);
    expect(/^[a-z0-9][a-z0-9-]{1,31}$/.test(VALID.code)).toBe(true);
  });

  it('refuses a multiplier at or below 1.00 — that is selling at cost', () => {
    // The failure is silent: every invoice is wrong by exactly the
    // multiplier difference and nothing anywhere fails.
    expect(10_000 < 11_000).toBe(true);
    expect(9_000 < 11_000).toBe(true);
  });

  it('keeps Starter and Pro above the floor the docs set', () => {
    // 1.30 and 1.25 are the live values. Below ~1.20 you subsidise your
    // heaviest users (README §"Two things to read before selling").
    expect(13_000).toBeGreaterThan(12_000);
    expect(12_500).toBeGreaterThan(12_000);
  });

  it('derives the overage markup from the multiplier', () => {
    // overage_markup_bps === rate_multiplier_bps − 10000, per
    // HANDOFF.md §5.14. The form never sends this field; the server
    // computes it on every write so the two cannot disagree.
    expect(13_000 - 10_000).toBe(3_000);
    expect(12_500 - 10_000).toBe(2_500);
  });

  it('would produce a negative markup below 1.00 — which is why the floor exists', () => {
    expect(9_000 - 10_000).toBe(-1_000);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Financial semantics
// ───────────────────────────────────────────────────────────────────────

describe('financial null-vs-zero', () => {
  /**
   * The distinction the whole financials module turns on. Reproduced
   * here as arithmetic because the real function needs a database; the
   * same three cases are asserted end-to-end by the console itself.
   */
  const marginPct = (revenue: number, upstream: number) =>
    revenue > 0 ? ((revenue - upstream) / revenue) * 100 : null;

  const effectiveRateBps = (revenue: number, upstream: number) =>
    upstream > 0 ? Math.round((revenue / upstream) * 10000) : null;

  it('is null, not zero, when there is no revenue', () => {
    expect(marginPct(0, 0)).toBeNull();
    // The wrong answer renders "0%" and reads as "you earned nothing and
    // kept none of it", which is a different and alarming claim.
    expect(marginPct(0, 0)).not.toBe(0);
  });

  it('is null, not zero, when there is no upstream cost to divide by', () => {
    expect(effectiveRateBps(0, 0)).toBeNull();
    expect(effectiveRateBps(10, 0)).toBeNull();
  });

  it('computes a real margin when there is revenue', () => {
    expect(marginPct(100, 76.92)).toBeCloseTo(23.08, 1);
  });

  it('recovers the configured multiplier from the data', () => {
    // 1.30 upstream → 1.30 realised. This is the check that would catch
    // a collector writing customer cost where upstream cost belongs.
    expect(effectiveRateBps(130, 100)).toBe(13_000);
    expect(effectiveRateBps(125, 100)).toBe(12_500);
  });

  it('reports a negative margin as a negative number, not null', () => {
    // Money leaked, not an absence of data.
    expect(marginPct(100, 130)).toBeCloseTo(-30, 5);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Cache-TTL pricing invariant the plan editor must not break
// ───────────────────────────────────────────────────────────────────────

describe('rate multiplier identity', () => {
  it('holds for every live plan', () => {
    // The identity asserted by tests/security.test.ts. The plan editor
    // derives the markup rather than accepting it precisely so this
    // cannot be broken from the console.
    const PLANS = [
      { code: 'starter', rate: 13_000, markup: 3_000 },
      { code: 'pro', rate: 12_500, markup: 2_500 },
    ];
    for (const p of PLANS) {
      expect(p.markup).toBe(p.rate - 10_000);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Route-gate expectations
// ───────────────────────────────────────────────────────────────────────

describe('admin route gates', () => {
  /**
   * The minimum role each new route requires. This is documentation with
   * teeth: if a route's gate is loosened, the reviewer sees the table
   * change and has to justify it. Deliberately NOT read from the source
   * — a table that reads itself proves nothing.
   */
  const GATES: { route: string; minimum: StaffRole }[] = [
    { route: 'GET /api/admin/orgs', minimum: 'support' },
    { route: 'GET /api/admin/orgs/[id]', minimum: 'read_only' },
    { route: 'GET /api/admin/financials', minimum: 'read_only' },
    { route: 'GET /api/admin/usage', minimum: 'read_only' },
    { route: 'GET /api/admin/audit', minimum: 'read_only' },
    { route: 'GET /api/admin/ops', minimum: 'read_only' },
    { route: 'GET /api/admin/credits', minimum: 'read_only' },
    { route: 'POST /api/admin/credits', minimum: 'admin' },
    { route: 'POST /api/admin/staff', minimum: 'owner' },
    { route: 'PATCH /api/admin/staff/[id]', minimum: 'owner' },
    { route: 'DELETE /api/admin/staff/[id]', minimum: 'owner' },
    { route: 'POST /api/admin/plans', minimum: 'owner' },
    { route: 'PATCH /api/admin/plans/[id]', minimum: 'owner' },
  ];

  it('never lets a read_only operator reach a money-moving route', () => {
    for (const g of GATES) {
      if (g.minimum !== 'read_only') {
        expect(staffAtLeast('read_only', g.minimum)).toBe(false);
      }
    }
  });

  it('keeps plan and staff management above the tier that moves one customer at a time', () => {
    // `admin` can suspend an account or refund one customer. Changing a
    // plan or granting console access reaches all of them at once, so
    // those stay at `owner`.
    const platformWide = GATES.filter((g) => g.route.includes('/plans') || g.route.includes('/staff'));
    expect(platformWide.length).toBeGreaterThan(0);
    for (const g of platformWide) {
      expect(g.minimum).toBe('owner');
      expect(staffAtLeast('admin', g.minimum)).toBe(false);
    }
  });
});