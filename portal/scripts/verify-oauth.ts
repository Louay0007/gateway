/**
 * Prove the OAuth wiring of every configured provider — no network, no
 * database.
 *
 *   make verify-oauth
 *
 * WHY THIS IS A SCRIPT AND NOT ONLY A UNIT TEST. The unit tests prove the
 * ADAPTERS (recorded fixtures) and the POLICY (pure). What they cannot prove
 * is that THIS DEPLOYMENT is configured coherently, which is the class of
 * mistake that reads as "the button does nothing":
 *
 *   - a provider variable present in `.env` but absent from the container
 *     (docker-compose is an allowlist) — reported as not configured
 *   - credentials that LOOK set but are placeholders (`your-id-here`), which
 *     `enabledProviders()` counts as configured and the provider rejects
 *     after consent
 *   - a callback URL that does not match the one the console was given — the
 *     single most common cause of `redirect_uri_mismatch`
 *
 * Everything here is read-only and offline: it parses env and builds the
 * authorization URL each adapter would build. No provider is contacted.
 * Safe to run against a live stack.
 *
 * Exit code is 1 when a CONFIGURED provider has a fault. A provider that is
 * simply not configured is reported and skipped: that is a supported state.
 */
import './env.mjs';

import { createHash, randomBytes } from 'node:crypto';

import { callbackUrlFor, canonicalOrigin } from '@/lib/auth/oauth/urls';
import {
  enabledProviders,
  providerConfig,
  clientSecretFor,
  offeredProviders,
  type ProviderId,
} from '@/lib/auth/oauth';

/**
 * PKCE/state generated here rather than imported from
 * `lib/auth/oauth/state.ts`: that module imports `next/headers`, which has
 * no meaning outside a request (and does not even resolve under plain
 * `node`). The values only need to LOOK real to build the URL.
 */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function challengeFor(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail, null, 2));
  }
}

/** Values that LOOK configured but are the shape of a copy-pasted placeholder. */
const PLACEHOLDER = /^(your[-_]?|<.*>|\.\.\.|changeme|todo|xxx)/i;

/**
 * The providers this build knows about, taken from the registry so this
 * script cannot drift from the code. Apple was removed; re-adding it to
 * `ProviderId` and `ORDER` is enough to bring it back here.
 */
const ALL: ProviderId[] = offeredProviders();

/** The env var names each provider reads, for the "why is my button dead" answer. */
const ENV_FOR: Record<ProviderId, string[]> = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
};

async function main() {
  console.log('OAuth wiring — offline configuration check\n');

  // ── 0. The origin every callback is built from ────────────────────
  const origin = canonicalOrigin('http://localhost:3000/api/oauth/google/start');
  console.log(`canonical origin: ${origin}\n`);
  check(
    'AUTH_URL (or NEXT_PUBLIC_APP_URL) is set to an absolute origin',
    /^https?:\/\//.test(origin),
    { origin },
  );
  check(
    'the origin is https outside localhost',
    origin.startsWith('https://') || /^http:\/\/localhost/.test(origin),
    { origin, hint: 'a provider will refuse an http callback that is not localhost' },
  );

  const enabled = enabledProviders();

  for (const id of ALL) {
    console.log(`\n${id}`);
    const config = providerConfig(id);

    if (!config) {
      // Not configured is a supported state: the button is still rendered
      // (offeredProviders) but a click lands on /sign-in?social=unavailable.
      console.log(`  · not configured — set ${ENV_FOR[id].join(', ')} to enable`);
      check(`${id} is absent from the enabled list`, !enabled.includes(id));
      continue;
    }

    check(`${id} is in enabledProviders()`, enabled.includes(id));

    // ── Placeholder detection ─────────────────────────────────────
    const rawClientId = config.clientId;
    check(
      `${id} client id is not a placeholder`,
      !PLACEHOLDER.test(rawClientId),
      { value: redact(rawClientId) },
    );

    check(
      `${id} client secret is not a placeholder`,
      !PLACEHOLDER.test(config.clientSecret),
      { length: config.clientSecret.length },
    );

    // ── The authorization URL the adapter would build ─────────────
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(32));
    const nonce = id === 'github' ? undefined : b64url(randomBytes(32));
    const redirectUri = callbackUrlFor(`${origin}/api/oauth/${id}/start`, id);
    let authz: string;
    try {
      authz = config.adapter.authorizationUrl({
        clientId: config.clientId,
        redirectUri,
        state,
        codeChallenge: challengeFor(verifier),
        nonce,
      });
    } catch (e) {
      check(`${id} builds an authorization URL`, false, {
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const parsed = new URL(authz);
    const params = parsed.searchParams;
    check(`${id} authorization URL is https`, parsed.protocol === 'https:', {
      url: `${parsed.origin}${parsed.pathname}`,
    });
    check(`${id} sends PKCE S256`, params.get('code_challenge_method') === 'S256');
    check(`${id} sends a code_challenge`, (params.get('code_challenge')?.length ?? 0) > 0);
    check(`${id} sends state`, params.get('state') === state);
    check(`${id} sends redirect_uri = ${redirectUri}`, params.get('redirect_uri') === redirectUri);
    check(
      `${id} redirect_uri points at /api/oauth/${id}/callback`,
      (params.get('redirect_uri') ?? '').endsWith(`/api/oauth/${id}/callback`),
      { registered: `${origin}/api/oauth/${id}/callback` },
    );
    if (id !== 'github') {
      // GitHub has no id_token, so there is nothing for a nonce to bind.
      check(`${id} sends an OIDC nonce`, (params.get('nonce')?.length ?? 0) > 0);
    }

    // ── The secret that would actually be sent on exchange ────────
    try {
      const secret = await clientSecretFor(id, config);
      check(`${id} can produce a client secret`, secret.length > 0);
    } catch (e) {
      check(`${id} can produce a client secret`, false, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── The registration text an operator has to paste ────────────────
  console.log('\ncallback URLs to register with each provider console:');
  for (const id of ALL) {
    console.log(`  ${id.padEnd(7)} ${origin}/api/oauth/${id}/callback`);
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  const configured = enabled.length;
  console.log(
    configured === 0
      ? 'No provider configured — social sign-in is off. That is a supported state.'
      : `All configured providers passed (${configured}/${ALL.length} enabled).`,
  );
}

/**
 * Show enough of a client id to recognise it, never the whole value.
 * A client id is public, but a misconfigured `.env` sometimes has the SECRET
 * on the id line, and a verify script has no business echoing that.
 */
function redact(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

main().catch((e) => {
  console.error('verify-oauth crashed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
