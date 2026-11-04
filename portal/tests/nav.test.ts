/**
 * Nav entries may carry a landing query (`/dashboard/settings?tab=profile`).
 *
 * The sidebar's active check and the header's title lookup both compared a
 * pathname against the raw href. `usePathname()` never returns a query, so
 * any entry with one was permanently un-highlighted and titled "Dashboard".
 * Asserted here because the symptom is invisible in typecheck and in tests
 * that only walk the happy path.
 */

import { describe, expect, it } from 'vitest';

import { navMain, navSecondary, titleForPath } from '../components/dashboard/nav';

const pathOf = (href: string) => href.split('?')[0];

describe('titleForPath', () => {
  it('titles a page whose nav entry carries a landing query', () => {
    expect(titleForPath('/dashboard/settings')).toBe('Settings');
  });

  it('still titles entries without a query, and nested paths under them', () => {
    expect(titleForPath('/dashboard')).toBe('Overview');
    expect(titleForPath('/dashboard/keys')).toBe('API keys');
  });

  it('falls back rather than guessing for an unknown path', () => {
    expect(titleForPath('/nope')).toBe('Dashboard');
  });
});

describe('sidebar active matching', () => {
  // Mirrors app-sidebar.tsx `active()`: compare the pathname against the
  // href with its query stripped.
  const isActive = (href: string, pathname: string) => {
    const path = pathOf(href);
    return path === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === path || pathname.startsWith(`${path}/`);
  };

  it('highlights an entry that carries a query', () => {
    const settings = [...navMain, ...navSecondary].find((i) => i.title === 'Settings');
    expect(settings, 'Settings must exist in nav').toBeDefined();
    expect(isActive(settings!.href, '/dashboard/settings')).toBe(true);
  });

  it('does not highlight a sibling that merely shares a prefix', () => {
    expect(isActive('/dashboard/settings', '/dashboard/keys')).toBe(false);
  });
});
