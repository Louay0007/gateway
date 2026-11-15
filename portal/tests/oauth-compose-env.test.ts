/**
 * The compose → container plumbing for the provider credentials.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `docker-compose.yml` lists portal
 * environment variables explicitly — it is an allowlist, not a pass-through.
 * A provider variable present in `.env` but missing from that list never
 * reaches the container, and the ONLY symptom is a missing button:
 *
 *   - `enabledProviders()` sees nothing
 *   - the sign-in page renders no social row
 *   - nothing errors, nothing logs, the page looks exactly as it should for
 *     a deployment that has not configured social sign-in
 *
 * That is the worst shape of bug: indistinguishable from "not set up yet".
 * This test reads both files from disk and asserts they agree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const COMPOSE = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
const ENV_EXAMPLE = readFileSync(resolve(ROOT, '.env.example'), 'utf8');

/** The eight variables the OAuth adapters read. */
const PROVIDER_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'APPLE_TEAM_ID',
  'APPLE_SERVICES_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
] as const;

/** The portal service block, so a var on another service does not count. */
function portalBlock(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^\s{2}portal:\s*$/.test(l));
  if (start === -1) throw new Error('portal service not found in docker-compose.yml');
  // Ends at the next service at the same indent.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{2}[a-z][a-z0-9_-]*:\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('docker-compose forwards every provider variable to the portal', () => {
  const portal = portalBlock(COMPOSE);

  it.each(PROVIDER_VARS)('%s reaches the container', (name) => {
    // Matches `NAME: ${NAME:-}` — the optional form the comment requires.
    expect(portal).toMatch(new RegExp(`^\\s+${name}:\\s*\\$\\{${name}:-\\}`, 'm'));
  });

  it('uses the OPTIONAL form, never a `:?` required guard', () => {
    // `:?` would make `docker compose up` refuse to start a deployment that
    // simply does not offer social sign-in. Every provider is optional.
    for (const name of PROVIDER_VARS) {
      expect(portal).not.toMatch(new RegExp(`\\$\\{${name}:\\?`));
    }
  });
});

describe('.env.example documents every provider variable', () => {
  it.each(PROVIDER_VARS)('%s is documented (even commented out)', (name) => {
    // A variable that exists only in docker-compose.yml is un-discoverable:
    // an operator configuring a provider needs to know it exists.
    expect(ENV_EXAMPLE).toContain(name);
  });

  it('documents the callback path the consoles must be given', () => {
    // The single most common cause of redirect_uri_mismatch.
    expect(ENV_EXAMPLE).toContain('/api/oauth/google/callback');
    expect(ENV_EXAMPLE).toContain('/api/oauth/github/callback');
    expect(ENV_EXAMPLE).toContain('/api/oauth/apple/callback');
  });

  it('ships the provider values EMPTY, never with a placeholder that looks set', () => {
    // A placeholder like `GOOGLE_CLIENT_ID=your-id-here` is worse than
    // empty: enabledProviders() treats any non-blank string as configured,
    // so the button renders and the provider rejects it after consent.
    for (const name of PROVIDER_VARS) {
      const assigned = new RegExp(`^${name}=(.+)$`, 'm').exec(ENV_EXAMPLE);
      if (assigned) {
        // If uncommented at all, it must be blank.
        expect(assigned[1]!.trim()).toBe('');
      }
    }
  });
});
