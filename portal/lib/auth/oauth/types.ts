/**
 * The provider adapter contract — the only provider-specific code in the
 * OAuth implementation.
 *
 * WHY THIS EXISTS. Google, GitHub and Apple disagree about almost
 * everything: how many requests it takes to learn the email, whether
 * `email_verified` is a boolean or the string "true", whether the identity
 * is in a JSON body or inside a signed JWT. Everything ABOVE this interface
 * (state, PKCE, the linking rule, session minting) must never branch on
 * provider, or the linking rule has three implementations and one of them
 * will be wrong.
 *
 * Nothing here performs a redirect or touches a cookie. Adapters are pure
 * request/response mapping so they can be tested against recorded fixtures
 * with no network (portal/tests/oauth-adapters.test.ts).
 */

export type ProviderId = 'google' | 'github' | 'apple';

/** Human label. Used in UI copy and logs — never in comparison. */
export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** Where the user is sent to consent. */
  authorizationEndpoint: string;
  /** Scopes, exactly as the provider documents them. */
  scope: string;
}

/**
 * One identity, normalised. This is the ONLY shape the linking rule sees.
 *
 * `emailVerified` is a boolean here even though Apple sends the string
 * "true" and GitHub sends nothing at all — normalisation at the edge means
 * `resolveIdentity` cannot get it wrong per-provider.
 */
export interface OAuthIdentity {
  /** The provider's immutable id: Google `sub`, GitHub numeric `id`, Apple `sub`. */
  providerAccountId: string;
  /** NULL when the provider will not disclose one (GitHub without user:email). */
  email: string | null;
  /** False when the provider has not proven the address, or said nothing. */
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  /** Provider handle (GitHub login). NULL elsewhere. Never an identifier. */
  login: string | null;
  /** Apple's relay address. Always false for Google and GitHub. */
  isPrivateRelay: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

export interface AuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  /** base64url(SHA-256(verifier)). PKCE S256 only — never `plain`. */
  codeChallenge: string;
  /** OIDC nonce. Apple and Google both accept it; it binds the id_token. */
  nonce?: string;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  /**
   * Google/GitHub: the static secret from env.
   * Apple: a JWT minted per request (see apple.ts) — Apple gives out no
   * static secret, and the one we sign expires.
   */
  clientSecret: string;
}

export interface FetchIdentityInput {
  accessToken: string;
  /** Present for Apple always, and for Google when `openid` was granted. */
  idToken?: string;
  /**
   * Apple sends the user's name ONCE, in the POST body of the callback, and
   * never again. Passed through here so the adapter can merge it into the
   * identity; NULL for the other providers.
   */
  initialName?: { firstName?: string; lastName?: string } | null;
  /**
   * The OIDC client id (= Services ID on Apple). Required whenever an
   * id_token is verified, because `aud` is the ONLY claim that proves the
   * token was minted for THIS application. Without it, a token issued to a
   * different client of the same provider would verify, and an attacker
   * who controls any OAuth client of that provider could present their own
   * users' tokens to us.
   */
  clientId: string;
  /** The nonce we sent on the authz request, when we sent one. */
  nonce?: string;
}

export interface OAuthAdapter extends ProviderMeta {
  authorizationUrl(input: AuthorizationUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokens>;
  fetchIdentity(input: FetchIdentityInput): Promise<OAuthIdentity>;
}

/**
 * A provider answered with something we will not accept.
 *
 * Carries no response body: provider errors can echo the authorization
 * code, and that code is a bearer credential for one exchange. Only the
 * status and a short, fixed reason travel.
 */
export class OAuthProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly reason: string,
  ) {
    super(`${provider}: ${reason} (${status})`);
    this.name = 'OAuthProviderError';
  }
}

/** Every provider call is bounded — a hanging callback holds a slot. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * `fetch` with the two things every provider call needs: a hard timeout and
 * an explicit Accept. Returns the raw Response; the caller decides what a
 * non-2xx means, because the three providers disagree.
 *
 * NOTE: no User-Agent spoofing here. The upstream gateway needs one (it sits
 * behind Cloudflare), the identity providers do not.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // A provider call must never be cached by anything.
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise `email_verified` across providers.
 *
 * Google sends a boolean. Apple sends the STRING "true". GitHub expresses it
 * per-address as `verified`. Anything else — missing, null, "false", a
 * number — is NOT verified, because the failure mode of guessing wrong is
 * account takeover (an unverified address auto-links to an existing user).
 */
export function isVerifiedClaim(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}
