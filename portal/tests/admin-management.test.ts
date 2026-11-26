/**
 * The management console's invariants — the ones whose violation is SILENT.
 *
 * None of these throws at runtime:
 *
 *   - removing a subscription with a DELETE instead of a status change takes
 *     the payment history with it, and the failure looks like "no data";
 *   - a payments page that sums two rails produces a number that is wrong by
 *     an unknown amount and reconciles to nothing;
 *   - an unlock that clears the wrong throttle bucket unlocks every account
 *     behind an IP address;
 *   - a search that does not escape `%` matches every row and LOOKS like a
 *     working search.
 *
 * Pure where possible, source assertions where the property lives in SQL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = process.cwd();
const read = (rel: string) => readFileSync(join(PORTAL, rel), 'utf8');

// ───────────────────────────────────────────────────────────────────────
//  Removal is a status change, never a DELETE
// ───────────────────────────────────────────────────────────────────────

describe('subscription removal', () => {
  const src = read('lib/admin/subscriptions.ts');

  it('never issues a DELETE against a subscription', () => {
    // `payments_d17.subscription_id` and `trial_redemptions.subscription_id`
    // are ON DELETE CASCADE, so a delete here silently erases the evidence
    // that money arrived.
    expect(src).not.toMatch(/\.delete\(\s*subscriptions\s*\)/);
    expect(src).not.toMatch(/DELETE\s+FROM\s+subscriptions/i);
  });

  it('sets the columns the migration added, not just the status', () => {
    for (const col of ['removedAt', 'removedBy', 'removalReason']) {
      expect(src, `removal must record ${col}`).toContain(col);
    }
  });

  it('syncs the gateway after committing the row', () => {
    // A row change with no sync leaves a cancelled account still able to
    // spend, which is worse than no button at all.
    const removeFn = src.slice(src.indexOf('export async function adminRemoveSubscription'));
    const body = removeFn.slice(0, removeFn.indexOf('export async function adminExtendPeriod'));
    expect(body).toContain('syncOrganizationEntitlements');
    // ...and reports a sync failure rather than rolling back a real change.
    expect(body).toContain('syncOk: sync.ok');
  });

  it('requires a reason', () => {
    const src2 = src.slice(src.indexOf('export async function adminRemoveSubscription'));
    expect(src2).toContain("error: 'reason_required'");
  });

  it('refuses an abandoned checkout', () => {
    // An `incomplete` row is a payment attempt that never completed — there is
    // no service to remove, and marking it canceled erases that fact.
    const src2 = src.slice(src.indexOf('export async function adminRemoveSubscription'));
    expect(src2).toContain("target.sub.status === 'incomplete'");
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Extend adds to the period, it does not replace it
// ───────────────────────────────────────────────────────────────────────

describe('period extension', () => {
  const src = read('lib/admin/subscriptions.ts');
  const body = src.slice(src.indexOf('export async function adminExtendPeriod'));

  it('adds to the existing end rather than starting a new window', () => {
    // A grant SETS the window (grantPlan/periodFor); an extension must not,
    // or the unused remainder of the paid period is swallowed.
    expect(body).toContain('current_period_end');
    expect(body).not.toContain('periodFor');
    expect(body).toContain('getTime() + days');
  });

  it('is capped, so a mistyped number cannot hand out a decade', () => {
    expect(src).toContain('MAX_EXTEND_DAYS');
    expect(body).toContain('MAX_EXTEND_DAYS');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Two money rails, never summed
// ───────────────────────────────────────────────────────────────────────

describe('payments ledger', () => {
  const src = read('lib/admin/payments.ts');
  const page = read('app/admin/payments/page.tsx');

  it('only claims one rail in the database', () => {
    // Dodo is a hosted checkout: no amount and no receipt are stored, so the
    // type must not admit a second rail it cannot populate honestly.
    expect(src).toMatch(/rail: 'd17'/);
  });

  it('the page says where card payments are, rather than omitting them', () => {
    // A page called "Payments" that silently drops card revenue is worse than
    // one that names it.
    expect(page).toMatch(/Card payments are not on this page/i);
    expect(page).toContain('Dodo');
  });

  it('lists unprocessed webhooks, worst first', () => {
    expect(src).toContain('processed_at IS NULL');
    expect(src).toContain('attempts DESC');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Recovery clears the identity bucket, not the IP bucket
// ───────────────────────────────────────────────────────────────────────

describe('account recovery', () => {
  const src = read('lib/admin/system.ts');

  it('unlocks by the identity bucket only', () => {
    // `bucketsFor()` also derives an `ip:` bucket. Clearing that would unlock
    // every account behind the same address.
    expect(src).toContain('id:${email}');
    expect(src).not.toMatch(/DELETE FROM auth_login_attempts\s+WHERE bucket LIKE 'ip:/);
  });

  it('cannot set a password', () => {
    // The invariant: staff act ON an account, never AS the person.
    for (const forbidden of ['hashPassword', 'setPassword', 'authCredentials']) {
      expect(src, `recovery must not touch ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('re-sends through the signup path rather than minting its own token', () => {
    expect(src).toContain('sendVerificationEmail');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Search patterns are escaped
// ───────────────────────────────────────────────────────────────────────

describe('customer search', () => {
  it('escapes LIKE wildcards, so "100%" is not a match-everything', () => {
    const src = read('lib/admin/customers.ts');
    expect(src).toMatch(/replace\(\/\[\\\\%_\]\/g/);
  });

  it('binds id lists with sql.join rather than interpolating an array', () => {
    // Postgres binds a JS array as ONE parameter and answers "malformed array
    // literal" — the trap lib/billing/d17-admin.ts documents. And a hand-built
    // `ANY(ARRAY['…'])` would be string concatenation of values into SQL.
    //
    // Asserted on the CALL, not the word: the file's own comment explains why
    // `sql.raw` is wrong, and a prose mention must not fail the check.
    const src = read('lib/admin/customers.ts');
    expect(src).toContain('sql.join(');
    expect(src).not.toMatch(/=?\s*sql\.raw\(/);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Every new page and route exists, and is gated
// ───────────────────────────────────────────────────────────────────────

describe('the management surface is wired', () => {
  const pages = [
    'app/admin/customers/page.tsx',
    'app/admin/customers/[id]/page.tsx',
    'app/admin/subscriptions/page.tsx',
    'app/admin/payments/page.tsx',
    'app/admin/payments/[id]/page.tsx',
    'app/admin/trials/page.tsx',
    'app/admin/system/page.tsx',
  ];

  it.each(pages)('%s exists', (p) => {
    expect(existsSync(join(PORTAL, p)), `${p} is missing`).toBe(true);
  });

  const routes: [string, string][] = [
    ['app/api/admin/customers/route.ts', 'support'],
    ['app/api/admin/customers/[id]/route.ts', 'support'],
    ['app/api/admin/payments/route.ts', 'support'],
    ['app/api/admin/payments/events/route.ts', 'support'],
    ['app/api/admin/trials/route.ts', 'owner'],
    ['app/api/admin/trials/[id]/route.ts', 'owner'],
    ['app/api/admin/trials/[id]/redemptions/route.ts', 'support'],
    ['app/api/admin/system/route.ts', 'support'],
    ['app/api/admin/system/unlock/route.ts', 'support'],
    ['app/api/admin/system/resend-verification/route.ts', 'support'],
    ['app/api/admin/orgs/[id]/subscription/cancel/route.ts', 'admin'],
    ['app/api/admin/orgs/[id]/subscription/resume/route.ts', 'admin'],
    ['app/api/admin/orgs/[id]/subscription/extend/route.ts', 'admin'],
    ['app/api/admin/orgs/[id]/subscription/remove/route.ts', 'owner'],
    ['app/api/admin/orgs/[id]/keys/[keyId]/revoke/route.ts', 'admin'],
    ['app/api/admin/orgs/[id]/devices/[deviceId]/revoke/route.ts', 'admin'],
    ['app/api/admin/orgs/[id]/notes/route.ts', 'support'],
    ['app/api/admin/orgs/[id]/notes/[noteId]/route.ts', 'support'],
  ];

  it.each(routes)('%s requires %s', (path, rank) => {
    expect(existsSync(join(PORTAL, path)), `${path} is missing`).toBe(true);
    // The rank must be enforced by the handler, not merely intended: every
    // route re-checks, because the proxy only decides whether it is reached.
    expect(read(path)).toContain(`requireStaff('${rank}')`);
  });

  it('the nav offers every new page', () => {
    const nav = read('components/admin/admin-sidebar.tsx');
    for (const href of [
      '/admin/customers',
      '/admin/subscriptions',
      '/admin/payments',
      '/admin/trials',
      '/admin/system',
    ]) {
      expect(nav, `${href} is not in the nav`).toContain(href);
    }
  });
});
