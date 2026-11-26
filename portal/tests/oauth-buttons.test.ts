/**
 * The social button row — plan §7.
 *
 * These are the rules that, broken, produce a sign-in page that looks fine
 * and is wrong:
 *
 *   - a button for a provider that is not configured ("it 500s on click is
 *     worse than no button")
 *   - a notice that reflects the query string back as text
 *   - a provider marked aria-hidden that IS the accessible name
 *   - Google's mark recoloured to match the theme (a brand violation)
 *
 * Rendering is not exercised (the suite is node-only, no DOM); what is
 * asserted is the data contract the component and its pages depend on.
 */
import { describe, it, expect } from 'vitest';
import { socialNotice, SocialNotice } from '@/components/auth/social-buttons';
import {
  enabledProviders,
  enabledProviderLabels,
  offeredProviders,
} from '@/lib/auth/oauth';
import { GoogleIcon, GitHubIcon } from '@/assets/brand/provider-icons';

describe('socialNotice — fixed copy, never reflected text', () => {
  it('returns null when there is no reason (the clean case)', () => {
    expect(socialNotice(undefined)).toBeNull();
    expect(socialNotice('')).toBeNull();
  });

  it('maps each known reason to a sentence', () => {
    expect(socialNotice('cancelled')).toMatch(/cancelled/i);
    expect(socialNotice('expired')).toMatch(/expired/i);
    expect(socialNotice('failed')).toMatch(/could not/i);
    // The unconfigured-provider case. The copy names the situation and
    // points at the method that works, rather than reporting an outage.
    expect(socialNotice('unavailable')).toMatch(/not enabled/i);
    expect(socialNotice('unavailable')).toMatch(/email and password/i);
    expect(socialNotice('unknown_provider')).toMatch(/not available/i);
  });

  it('NEVER echoes an unknown reason back to the page', () => {
    // The reflected-text hazard: `?social=<script>` must not render as
    // itself. An unknown reason gets the generic sentence.
    const injected = '<img src=x onerror=alert(1)>';
    const message = socialNotice(injected);
    expect(message).not.toContain('<img');
    expect(message).not.toContain('onerror');
    expect(message).toMatch(/could not/i);
  });

  it('is a total function — every string yields a string or null', () => {
    for (const s of ['', ' ', 'cancelled ', 'CANCELLED', '__proto__', 'toString', 'constructor']) {
      const out = socialNotice(s);
      expect(out === null || typeof out === 'string').toBe(true);
    }
  });

  it('does not let a prototype key resolve to a function', () => {
    // `NOTICES['toString']` would be Object.prototype.toString if the map
    // were a plain object and the lookup were unchecked. Rendering a
    // function as a child is a React crash.
    const out = socialNotice('toString');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/could not/i);
  });
});

describe('SocialNotice', () => {
  it('is a component (not a bare string helper) so both pages render identically', () => {
    expect(typeof SocialNotice).toBe('function');
  });
});

describe('offeredProviders — the buttons RENDER regardless of configuration', () => {
  // Reversal of the earlier rule, made deliberately. The row is shown so the
  // product looks complete while credentials are being issued; a click on an
  // unconfigured provider is refused by the start route BEFORE any redirect,
  // with a readable sentence. The old hazard (a button that dies after the
  // user commits) is gone because the refusal moved earlier, and the empty
  // row was the worse outcome.
  it('always offers every provider, configured or not', () => {
    expect(offeredProviders()).toEqual(['google', 'github']);
  });

  it('is independent of the environment', () => {
    // No argument and no env read: this is a product decision, not a
    // deployment fact.
    expect(offeredProviders()).toHaveLength(2);
  });

  it('labels every offered provider, even with nothing configured', () => {
    expect(enabledProviderLabels()).toEqual([
      { id: 'google', name: 'Google' },
      { id: 'github', name: 'GitHub' },
    ]);
  });
});

describe('enabledProviders — what can actually COMPLETE a sign-in', () => {
  // The second, separate question. The UI never calls this; the start route
  // and the callback do. Keeping the two apart is what lets the buttons show
  // while an unconfigured click is refused cleanly.
  const empty = {};

  it('returns nothing when no provider is configured', () => {
    expect(enabledProviders(empty)).toEqual([]);
  });

  it('omits a provider whose SECRET is missing (half-configured)', () => {
    // The classic broken deploy: id set, secret forgotten. Sending the user
    // to Google with an empty secret dies at the exchange, after consent.
    expect(enabledProviders({ GOOGLE_CLIENT_ID: 'id' })).toEqual([]);
    expect(enabledProviders({ GITHUB_CLIENT_SECRET: 'secret' })).toEqual([]);
  });

  it('includes a provider only when both halves are present', () => {
    expect(
      enabledProviders({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toEqual(['google']);
    expect(
      enabledProviders({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' }),
    ).toEqual(['github']);
  });

  it('treats a blank env value as absent', () => {
    // `GOOGLE_CLIENT_ID=` in a .env file is a defined, empty string — which
    // must not count as configured.
    expect(enabledProviders({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })).toEqual([]);
    expect(enabledProviders({ GOOGLE_CLIENT_ID: '   ', GOOGLE_CLIENT_SECRET: 's' })).toEqual([]);
  });
});

describe('provider marks', () => {
  it('each provider has a mark component', () => {
    for (const Icon of [GoogleIcon, GitHubIcon]) {
      expect(typeof Icon).toBe('function');
    }
  });
});
