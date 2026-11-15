/**
 * Apple — no userinfo endpoint, a client secret we mint, and identity only
 * inside a signed id_token.
 *
 * Four things break a naive adapter, each handled below:
 *
 *   1. APPLE HAS NO STATIC CLIENT SECRET. The `client_secret` is a JWT we
 *      sign with the .p8 (ES256). Its `exp` is capped at 6 months, and a
 *      value pasted into .env 7 months ago is a silent, total failure that
 *      looks like "Apple rejected the code". We mint it per request: it
 *      costs microseconds and cannot go stale.
 *   2. Identity is ONLY in the id_token — there is no endpoint to fetch it.
 *      The claims are therefore unverified input until the signature checks
 *      out against Apple's JWKS.
 *   3. `email_verified` and `is_private_email` are the STRINGS "true"/"false",
 *      not booleans. `if (claims.email_verified)` is true for the string
 *      "false" — that is the takeover bug this normalisation exists for.
 *   4. The user's NAME arrives once, in the callback's POST body, and never
 *      again. `initialName` is merged here because the adapter is the last
 *      place that still has it.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose';
import {
  isVerifiedClaim,
  OAuthProviderError,
  providerFetch,
  PROVIDER_TIMEOUT_MS,
  type OAuthAdapter,
  type OAuthIdentity,
  type OAuthTokens,
} from './types';

const AUTHZ = 'https://appleid.apple.com/auth/authorize';
const TOKEN = 'https://appleid.apple.com/auth/token';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

/**
 * The key resolver used to verify id_tokens.
 *
 * A module-level `createRemoteJWKSet` caches per process — correct in
 * production (one fetch, then cached until `cacheMaxAge`) and IMPOSSIBLE to
 * test, because the first test's stub is the key set for every later one.
 * So the resolver is a parameter with the remote set as the default:
 * production behaviour is unchanged, and a test can pass its own.
 */
export type AppleKeyResolver = Parameters<typeof jwtVerify>[1];
const remoteJwks = createRemoteJWKSet(new URL(JWKS_URL));

/** Apple's documented maximum. Six months is the cap, not a target. */
const SECRET_TTL_SECONDS = 15552000; // 180 days

/** The verified relaying domain suffix Apple uses for hidden addresses. */
const RELAY_DOMAIN = '@privaterelay.appleid.com';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export interface AppleCredentials {
  teamId: string;
  servicesId: string;
  keyId: string;
  /** PEM. Real newlines — decodePkcs8 accepts "\n" literals too, see below. */
  privateKey: string;
}

/**
 * Read the .p8 out of the environment.
 *
 * Three shapes are accepted because all three are what people actually end
 * up with after pasting into a .env, and the failure of getting it wrong is
 * an opaque "invalid_client" from Apple:
 *
 *   - a real multi-line PEM (quoted heredoc)
 *   - a single line with literal `\n` sequences (the common one)
 *   - base64 of the whole PEM (the only shape that survives some CI)
 *
 * Returns NULL when incomplete, so the provider is simply not offered —
 * a button that 500s on click is worse than no button.
 */
export function readAppleCredentials(
  env: Record<string, string | undefined> = process.env,
): AppleCredentials | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const servicesId = env.APPLE_SERVICES_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const raw = env.APPLE_PRIVATE_KEY?.trim();
  if (!teamId || !servicesId || !keyId || !raw) return null;

  let privateKey = raw;
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    // Not a PEM at all: assume base64 of one.
    try {
      privateKey = Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) return null;
  // Literal backslash-n from a single-line .env value.
  privateKey = privateKey.replace(/\\n/g, '\n');

  return { teamId, servicesId, keyId, privateKey };
}

/**
 * Mint the client secret. ES256, `iss` = Team ID, `sub` = Services ID,
 * `aud` = Apple, `exp` ≤ 6 months, `kid` = Key ID.
 *
 * Not cached: a cached JWT is a credential with a clock, and the only bug
 * it can produce is the one this function exists to prevent.
 */
export async function mintAppleClientSecret(creds: AppleCredentials): Promise<string> {
  const key = await importPKCS8(creds.privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId })
    .setIssuer(creds.teamId)
    .setSubject(creds.servicesId)
    .setAudience(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + SECRET_TTL_SECONDS)
    .sign(key);
}

interface AppleClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  is_private_email?: unknown;
  nonce?: unknown;
}

export function createAppleAdapter(
  creds: AppleCredentials,
  resolveKey: AppleKeyResolver = remoteJwks,
): OAuthAdapter {
  return {
    id: 'apple',
    name: 'Apple',
    authorizationEndpoint: AUTHZ,
    // `name email` is what Apple documents for web sign-in. Adding anything
    // else is refused at authorisation time, not at token time.
    scope: 'name email',

    authorizationUrl({ clientId, redirectUri, state, codeChallenge, nonce }) {
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: this.scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // `form_post`, not the query string: Apple POSTs the result. The
        // callback route must accept POST for this provider or every
        // sign-in 405s.
        response_mode: 'form_post',
      });
      if (nonce) p.set('nonce', nonce);
      return `${AUTHZ}?${p.toString()}`;
    },

    async exchangeCode({ code, redirectUri, codeVerifier, clientId, clientSecret }): Promise<OAuthTokens> {
      const res = await providerFetch(
        TOKEN,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
          }).toString(),
        },
        PROVIDER_TIMEOUT_MS,
      );

      if (!res.ok) {
        throw new OAuthProviderError('apple', res.status, 'token exchange failed');
      }

      const body = (await res.json()) as {
        access_token?: unknown;
        id_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        token_type?: unknown;
      };

      const accessToken = str(body.access_token);
      const idToken = str(body.id_token);
      // For Apple the id_token is the identity; an exchange that returns an
      // access token but no id_token cannot be completed, so it is an error
      // rather than a degraded sign-in.
      if (!accessToken || !idToken) {
        throw new OAuthProviderError('apple', res.status, 'token response missing access_token or id_token');
      }
      return {
        accessToken,
        idToken,
        refreshToken: str(body.refresh_token) ?? undefined,
        expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : undefined,
        tokenType: str(body.token_type) ?? undefined,
      };
    },

    async fetchIdentity({ idToken, clientId, nonce, initialName }): Promise<OAuthIdentity> {
      if (!idToken) {
        throw new OAuthProviderError('apple', 200, 'no id_token to verify');
      }

      let claims: AppleClaims;
      try {
        // Signature, `iss`, `aud` and expiry are all checked here. Until this
        // returns, NOTHING in the token is trusted — including `sub`, so no
        // lookup happens before it.
        const { payload } = await jwtVerify(idToken, resolveKey, {
          issuer: ISSUER,
          audience: clientId,
        });
        claims = payload as AppleClaims;
      } catch (e) {
        if (e instanceof OAuthProviderError) throw e;
        throw new OAuthProviderError('apple', 200, 'id_token failed verification');
      }

      // Nonce binds this id_token to the request we started. Apple echoes
      // it; a mismatch means the token belongs to another flow.
      if (nonce && claims.nonce !== nonce) {
        throw new OAuthProviderError('apple', 200, 'id_token nonce mismatch');
      }

      const sub = str(claims.sub);
      if (!sub) {
        throw new OAuthProviderError('apple', 200, 'id_token had no sub');
      }

      const email = str(claims.email);
      // The string form, because these claims are strings. `isVerifiedClaim`
      // treats "false" as false — the whole point.
      const emailVerified = isVerifiedClaim(claims.email_verified);
      const isPrivateRelay =
        isVerifiedClaim(claims.is_private_email) ||
        (email !== null && email.toLowerCase().endsWith(RELAY_DOMAIN));

      // The name arrives once, in the POST body. Both halves optional: Apple
      // omits `name` entirely on every consent after the first.
      const first = str(initialName?.firstName);
      const last = str(initialName?.lastName);
      const name = first || last ? [first, last].filter(Boolean).join(' ') : null;

      return {
        providerAccountId: sub,
        email,
        emailVerified,
        name,
        // Apple has no avatar endpoint. NULL, never a fabricated one.
        image: null,
        login: null,
        isPrivateRelay,
      };
    },
  };
}
