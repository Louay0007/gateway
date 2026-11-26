/**
 * The staff roster's 0053 contract.
 *
 * `hasCredential` means "this operator can sign in to the CONSOLE", and the
 * console has authenticated against `staff_credentials` since the console login
 * landed. It used to test for a `users` row — the PORTAL credential — which
 * after 0053 reported the wrong answer in both directions:
 *
 *   - an operator with a console password but no portal account was flagged
 *     "no sign-in account yet" even though they could sign in fine;
 *   - an operator with a portal account and NO console password was shown as
 *     fine, and then could not sign in at all — with nothing on screen saying
 *     why, and no way for them to discover it themselves.
 *
 * That is a SILENT failure: nothing throws, the roster renders, and the only
 * symptom is a person who cannot log in while the page implies they can. This
 * file pins the query so it cannot regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = process.cwd();
const read = (rel: string) => readFileSync(join(PORTAL, rel), 'utf8');

describe('staff roster credential state', () => {
  const src = read('lib/admin/staff.ts');

  it('derives hasCredential from staff_credentials, not from users', () => {
    const query = src.slice(src.indexOf('SELECT s.id::text'), src.indexOf('ORDER BY s.revoked_at'));
    expect(query).toContain('staff_credentials');
    // The portal mirror is the WRONG source after 0053.
    expect(query).not.toMatch(/FROM users u WHERE u\.email = s\.email/);
  });

  it('requires a username as well as a password row', () => {
    // A credential with no username cannot be typed into the login form, so
    // it is not a usable login.
    expect(src).toMatch(/s\.username IS NOT NULL AND EXISTS/);
  });

  it('exposes the username, so the roster can show what an operator types', () => {
    expect(src).toContain('username: string | null;');
    expect(src).toContain('username: r.username');
  });

  it('the roster renders the username and names the real blocker', () => {
    const ui = read('components/admin/staff-manager.tsx');
    expect(ui).toContain('s.username');
    // The old copy ("no sign-in account yet") was true of the portal
    // credential and misleading for the console one.
    expect(ui).toContain('no console password');
  });
});
