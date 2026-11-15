/**
 * Google — OIDC, one call for identity, boolean `email_verified`.
 *
 * The whole exchange is three requests and Google is the well-behaved one:
 * a static client secret, a JSON token response, and a userinfo endpoint
 * that returns every field we need.
 *
 * DECISION: identity comes from the id_token when one is present, and from
 * userinfo otherwise.
 *
 *   userinfo trusts the BEARER — whoever holds the access token gets the
 *   claims, so a token minted for a different client still answers. The
 *   id_token is signed by Google and carries `aud`, so a token issued for
 *   another application is rejected. When a token exchange includes an
 *   id_token (we always request `openid`), verifying it is strictly
 *   stronger and costs one JWKS fetch that `jose` caches per process.
 *
 * Both paths produce the same normalised identity, so the linking rule
 * cannot tell them apart.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  isVerifiedClaim,
  OAuthProviderError,
  providerFetch,
  type OAuthAdapter,
  type OAuthIdentity,
  type OAuthTokens,
} from './types';

const AUTHZ = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Only the claims we actually read. Everything else is ignored by design. */
interface GoogleClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function fromClaims(claims: GoogleClaims): OAuthIdentity {
  const sub = str(claims.sub);
  if (!sub) {
    // `sub` is the account id. Without it there is no identity to resolve,
    // and inventing one from the email would collide across providers.
    throw new OAuthProviderError('google', 200, 'userinfo returned no sub');
  }
  return {
    providerAccountId: sub,
    email: str(claims.email),
    // Google's own documented shape is a boolean. `isVerifiedClaim` also
    // accepts the string form, because the value's type has changed before
    // and a silent false here means "create a second account" rather than
    // "refuse".
    emailVerified: isVerifiedClaim(claims.email_verified),
    name: str(claims.name),
    image: str(claims.picture),
    login: null,
    isPrivateRelay: false,
  };
}

export const googleAdapter: OAuthAdapter = {
  id: 'google',
  name: 'Google',
  authorizationEndpoint: AUTHZ,
  scope: 'openid email profile',

  authorizationUrl({ clientId, redirectUri, state, codeChallenge, nonce }) {
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Forces the account chooser. Without it, a browser already signed
      // into one Google account silently reuses it — users think the
      // "Continue with Google" button signed them into someone else's
      // account on a shared machine.
      prompt: 'select_account',
      access_type: 'online',
    });
    if (nonce) p.set('nonce', nonce);
    return `${AUTHZ}?${p.toString()}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, clientId, clientSecret }): Promise<OAuthTokens> {
    const res = await providerFetch(TOKEN, {
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
    });

    if (!res.ok) {
      // The body is deliberately not included: Google's error responses are
      // safe, but the code we just sent is not, and logging a shape we do
      // not control is how it ends up in a log line.
      throw new OAuthProviderError('google', res.status, 'token exchange failed');
    }

    const body = (await res.json()) as {
      access_token?: unknown;
      id_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
      token_type?: unknown;
    };

    const accessToken = str(body.access_token);
    if (!accessToken) {
      throw new OAuthProviderError('google', res.status, 'token response had no access_token');
    }
    return {
      accessToken,
      idToken: str(body.id_token) ?? undefined,
      // Stored but never used to act on the user's behalf (§10 of the plan).
      refreshToken: str(body.refresh_token) ?? undefined,
      expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : undefined,
      scope: str(body.scope) ?? undefined,
      tokenType: str(body.token_type) ?? undefined,
    };
  },

  async fetchIdentity({ accessToken, idToken, clientId, nonce }): Promise<OAuthIdentity> {
    if (idToken) {
      try {
        const { payload } = await jwtVerify(idToken, JWKS, {
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          // `aud` proves the token was minted for OUR client. See the note
          // on FetchIdentityInput.clientId — omitting this is the standard
          // id_token reuse hole.
          audience: clientId,
        });
        if (nonce && payload.nonce !== nonce) {
          throw new OAuthProviderError('google', 200, 'id_token nonce mismatch');
        }
        return fromClaims(payload as GoogleClaims);
      } catch (e) {
        if (e instanceof OAuthProviderError) throw e;
        // A signature failure is NOT a fallback trigger: a token that fails
        // verification may be forged, and answering it from userinfo would
        // turn a tampered id_token into a successful sign-in.
        throw new OAuthProviderError('google', 200, 'id_token failed verification');
      }
    }

    const res = await providerFetch(USERINFO, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new OAuthProviderError('google', res.status, 'userinfo failed');
    }
    return fromClaims((await res.json()) as GoogleClaims);
  },
};
